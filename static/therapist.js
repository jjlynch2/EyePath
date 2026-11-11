"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const preview = new Stage($("#preview"));
let state = null;
let connected = false;

// ---- "Are you sure?" questions (Quit, Delete preset) in the page's own style; the
// browser's and system's dialogs show the page address or the wrong icon.
// Resolves true if the OK button was chosen; Cancel, Esc or a tap outside is false.
// `kind` names the question so it can be withdrawn when it no longer applies.
const confirmBox = $("#confirmDialog");
let asking = null;                       // the question on screen: { kind, answer }
function askConfirm(question, okLabel, kind = "", { body = "", icon = "warning--fill" } = {}) {
  if (!confirmBox.showModal) return Promise.resolve(confirm(question));   // browsers too old for <dialog>
  $("#confirmTitle").textContent = question;
  $("#confirmBody").textContent = body;
  $("#confirmBody").hidden = !body;
  $("#confirmIcon").setAttribute("href", `/static/icons/sprite.svg#${icon}`);
  $("#confirmOk").textContent = okLabel;
  confirmBox.returnValue = "";
  confirmBox.showModal();
  return new Promise((resolve) => { asking = { kind, answer: resolve }; });
}
function answerConfirm(yes) {
  const q = asking;
  asking = null;
  if (q) q.answer(yes);
}
// Withdraw the open question (all of them, or only one kind): answered "no" straight away.
function cancelConfirm(which = () => true) {
  if (!asking || !which(asking.kind)) return;
  answerConfirm(false);
  confirmBox.close("cancel");
}
confirmBox.addEventListener("click", (e) => { if (e.target === confirmBox) confirmBox.close("cancel"); });
confirmBox.addEventListener("close", () => {
  if (confirmBox.open) return;           // a late "closed" from an earlier question, already answered
  answerConfirm(confirmBox.returnValue === "ok");
});

// If the connection to the app stays down for a while, withdraw the question (its answer
// couldn't be sent). Brief blips, e.g. a reconnect, leave it alone.
let offlineTimer = null;
function connectionChanged(ok) {
  if (ok) {
    clearTimeout(offlineTimer);
    offlineTimer = null;
  } else if (!offlineTimer) {
    offlineTimer = setTimeout(() => { offlineTimer = null; if (!connected) cancelConfirm(); }, 5000);
  }
}

// Values changed here but not yet confirmed by the server. They win over
// incoming state for a moment so controls don't flicker while dragging.
const pending = new Map();    // key -> { value, until }

const LIMITS = { speed: [0.2, 4], passes: [1, 500], seconds: [3, 3600], size: [1, 30], pause: [0, 1000], travel: [30, 100], pitch: [100, 1200], audioOffset: [-300, 600] };

function params() {
  const p = { ...state.params };
  const now = performance.now();
  for (const [k, v] of pending) {
    if (v.until > now) p[k] = v.value; else pending.delete(k);
  }
  return p;
}

// ---- sending changes (throttled for sliders)
const queued = {};
let sendTimer = null;
function setParam(key, value, immediate = false) {
  pending.set(key, { value, until: performance.now() + 1500 });
  queued[key] = value;
  if (immediate) flush();
  else if (!sendTimer) sendTimer = setTimeout(flush, 60);
  renderControls();
}
// Send waiting changes now. Resolves once the server has them.
function flush() {
  clearTimeout(sendTimer);
  sendTimer = null;
  const changes = { ...queued };
  for (const k of Object.keys(queued)) delete queued[k];
  if (!Object.keys(changes).length) return Promise.resolve();
  return sendCommand({ type: "params", params: changes }).catch(() => false);
}

// Shape button icons come from the same drawings the light uses.
for (const btn of $$(".shapes button")) {
  const v = btn.dataset.value;
  btn.innerHTML = v in EMOJI
    ? `<img src="/static/emoji/${v}.svg" alt=""><span>${btn.title}</span>`
    : `<svg viewBox="0 0 100 100">${SHAPES[v] || '<circle cx="50" cy="50" r="46"/>'}</svg>`;
}

// ---- wiring controls
for (const input of $$("input[data-param]")) {
  const key = input.dataset.param;
  if (input.type === "checkbox") {
    input.addEventListener("change", () => setParam(key, input.checked, true));
  } else {
    input.addEventListener("input", () => setParam(key, input.dataset.num != null ? Number(input.value) : input.value));
    input.addEventListener("change", flush);
  }
}
for (const group of $$("[data-param]:not(input)")) {
  const key = group.dataset.param;
  for (const btn of $$("button[data-value]", group)) {
    btn.addEventListener("click", () => setParam(key, btn.dataset.value, true));
  }
}
for (const btn of $$("[data-step]")) {
  let hold = null, repeated = false;
  const release = () => { clearTimeout(hold); clearInterval(hold); hold = null; };
  // Stop at the limit: a disabled button gets no pointer events, so the release would be missed.
  const fire = () => { if (btn.disabled) release(); else step(btn.dataset.step, Number(btn.dataset.delta)); };
  btn.addEventListener("click", () => { if (repeated) repeated = false; else fire(); });
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    repeated = false;
    clearTimeout(hold);
    hold = setTimeout(() => { repeated = true; fire(); hold = setInterval(fire, 80); }, 400);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) btn.addEventListener(ev, release);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  // The finger may lift somewhere else, or the page may scroll or lose focus: any of those ends the hold.
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
  document.addEventListener("scroll", release, { passive: true });
  window.addEventListener("blur", release);
}
for (const btn of $$("[data-set]")) {
  btn.addEventListener("click", () => setParam(btn.dataset.set, Number(btn.dataset.value), true));
}

function step(key, delta) {
  if (!state) return;
  const [lo, hi] = LIMITS[key];
  const v = Math.min(hi, Math.max(lo, params()[key] + delta));
  setParam(key, Math.round(v * 100) / 100, true);
}

$("#startBtn").addEventListener("click", primary);
$("#stopNowBtn").addEventListener("click", () => sendCommand({ type: "stopNow" }));

function primary() {
  if (!state) return;
  sendCommand({ type: state.run.status === "running" ? "stop" : "start" });
}

// The floating round Start / Stop on the settings sections: Start set, then Stop after pass, then
// Stop now once the set is finishing. renderLive sets the step. Taps just after a change are
// ignored, so a double-tap can't run on to the next step (Stop after pass, then Stop now).
const quickGo = $("#quickGo");
const QUICK_SETTLE_MS = 450;
let quickMode = "start", quickChangedAt = 0;
const QUICK = {
  start: { icon: "play--fill", label: "Start set", command: "start" },
  stop: { icon: "stop--fill", label: "Stop after pass", command: "stop" },
  now: { icon: "x--regular", label: "Stop now", command: "stopNow" },
  end: { icon: "stop--fill", label: "Finishing this pass", command: null },
};
function renderQuickMode(mode) {
  quickMode = mode;
  quickChangedAt = performance.now();
  quickGo.className = `quick-go ${mode}`;
  quickGo.disabled = !QUICK[mode].command;
  $(".ico use", quickGo).setAttribute("href", `/static/icons/sprite.svg#${QUICK[mode].icon}`);
  quickGo.setAttribute("aria-label", QUICK[mode].label);
  quickGo.title = QUICK[mode].label;
}
quickGo.addEventListener("click", () => {
  const { command } = QUICK[quickMode];
  if (!state || !command || performance.now() - quickChangedAt < QUICK_SETTLE_MS) return;
  sendCommand({ type: command });
});

async function saveCurrentAs(input) {
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  await flush();           // the preset must include a change made just before saving
  sendCommand({ type: "savePreset", name });
}
$("#presetForm").addEventListener("submit", (e) => { e.preventDefault(); saveCurrentAs($("#presetName")); });

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input:not([type=range]):not([type=checkbox]), textarea, .editable") || e.metaKey || e.ctrlKey || e.altKey) return;
  if ($("dialog[open]")) return;         // Space and Esc belong to an open sheet or question
  if (e.code === "Space") { e.preventDefault(); primary(); }
  else if (e.key === "Escape") sendCommand({ type: "stopNow" });
  else if (e.key === "ArrowUp") { e.preventDefault(); step("speed", 0.1); }
  else if (e.key === "ArrowDown") { e.preventDefault(); step("speed", -0.1); }
  else if (/^[0-9]$/.test(e.key) && state) {
    const preset = state.presets[e.key === "0" ? 9 : Number(e.key) - 1];
    if (preset) sendCommand({ type: "loadPreset", name: preset.name });
  }
});

// ---- rendering
// ---- slider numbers: tap one to type an exact value (e.g. sound delay back to 0)
const NUMBERS = {
  speedVal:       { param: "speed", scale: 0.5, show: (v) => (v / 2).toFixed(2) },   // Hz: one sweep there and back
  sizeVal:        { param: "size", show: (v) => `${v}%` },
  pauseVal:       { param: "pause", show: (v) => `${v} ms` },
  travelVal:      { param: "travel", show: (v) => `${v}%` },
  heightVal:      { param: "height", show: (v) => (v === 0 ? "Centre" : `${Math.abs(v)}% ${v > 0 ? "higher" : "lower"}`) },
  volumeVal:      { param: "volume", scale: 100, show: (v) => `${Math.round(v * 100)}%` },
  pitchVal:       { param: "pitch", show: (v) => `${v} Hz` },
  audioOffsetVal: { param: "audioOffset", show: (v) => `${v} ms` },
  balanceVal:     { param: "balance", show: (v) => (v === 0 ? "Centre" : `${v > 0 ? "Left" : "Right"} ear ${Math.abs(v)}% quieter`) },
};
let editingNumber = null;

function renderNumbers(p) {
  for (const [id, n] of Object.entries(NUMBERS)) {
    if (id !== editingNumber) $(`#${id}`).textContent = n.show(p[n.param]);
  }
}

function editNumber(id) {
  const n = NUMBERS[id];
  const el = $(`#${id}`);
  const range = $(`input[type=range][data-param="${n.param}"]`);
  const scale = n.scale || 1;
  editingNumber = id;
  const input = Object.assign(document.createElement("input"), {
    type: "number", step: "any", inputMode: "decimal", className: "num-edit",
    min: Number(range.min) * scale, max: Number(range.max) * scale,
    value: Math.round(params()[n.param] * scale * 100) / 100,
  });
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    editingNumber = null;
    const v = parseFloat(input.value);
    if (save && Number.isFinite(v)) {
      setParam(n.param, Math.min(Number(range.max), Math.max(Number(range.min), v / scale)), true);
    } else {
      renderControls();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  el.replaceChildren(input);
  input.focus();
  input.select();
}

for (const id of Object.keys(NUMBERS)) {
  const el = $(`#${id}`);
  el.classList.add("editable");
  el.title = "Tap to type a value";
  el.tabIndex = 0;                 // reachable from a keyboard too
  el.setAttribute("role", "button");
  el.addEventListener("click", (e) => {
    if (e.target !== el || editingNumber === id || !state) return;
    e.preventDefault();          // don't let the surrounding label grab the click
    editNumber(id);
  });
  el.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === el && editingNumber !== id && state) { e.preventDefault(); editNumber(id); }
  });
}

// Left and right arrows move along a segmented control.
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const btn = e.target instanceof Element && e.target.closest(".seg > button");
  if (!btn) return;
  const next = e.key === "ArrowRight" ? btn.nextElementSibling : btn.previousElementSibling;
  if (next && next.tagName === "BUTTON") { e.preventDefault(); next.focus(); next.click(); }
});

$("#heightReset").addEventListener("click", () => setParam("height", 0, true));
$("#balanceReset").addEventListener("click", () => setParam("balance", 0, true));

function renderControls() {
  if (!state) return;
  const p = params();
  for (const input of $$("input[data-param]")) {
    if (document.activeElement === input && input.type !== "checkbox" && input.type !== "range") continue;
    const v = p[input.dataset.param];
    if (input.type === "checkbox") input.checked = !!v;
    else if (String(input.value) !== String(v)) input.value = v;
    if (input.type === "range") {   // the filled part of the track, from the left or from the centre
      const pct = ((v - input.min) / (input.max - input.min)) * 100;
      const centre = "centre" in input.dataset;
      input.style.setProperty("--lo", `${centre ? Math.min(50, pct) : 0}%`);
      input.style.setProperty("--hi", `${centre ? Math.max(50, pct) : pct}%`);
    }
  }
  for (const group of $$("[data-param]:not(input)")) {
    const v = p[group.dataset.param];
    for (const btn of $$("button[data-value]", group)) {
      btn.classList.toggle("on", btn.dataset.value === String(v));
      btn.setAttribute("aria-pressed", btn.dataset.value === String(v));
    }
  }
  for (const btn of $$("[data-set]")) btn.classList.toggle("on", Number(btn.dataset.value) === p[btn.dataset.set]);
  for (const btn of $$("[data-step]")) {
    const [lo, hi] = LIMITS[btn.dataset.step];
    const v = p[btn.dataset.step];
    btn.disabled = Number(btn.dataset.delta) < 0 ? v <= lo + 1e-9 : v >= hi - 1e-9;
  }

  renderNumbers(p);
  renderPresetMatch();
  $("#heightReset").hidden = p.height === 0;
  $("#balanceReset").hidden = p.balance === 0;
  $("#setVal").textContent = p.setMode === "passes" ? `${p.passes} passes`
    : p.setMode === "timer" ? fmtTime(p.seconds) : "Until you stop";
  $("#passesRow").hidden = p.setMode !== "passes";
  $("#timerRow").hidden = p.setMode !== "timer";
  renderSummaries(p);
  for (const el of $$("[data-show-easing]")) el.hidden = el.dataset.showEasing !== p.easing;   // one line about the chosen movement
  for (const el of $$("[data-show-sound]")) el.hidden = el.dataset.showSound !== p.sound;
  const running = state.run.status === "running";
  $("#patternNote").textContent = running && p.pattern !== state.run.pattern ? "Changes at the next set" : "";
  const setDual = running && state.run.dual ? `${state.run.dual.task}|${state.run.dual.level}` : "off";
  const wantDual = p.dualTask === "off" ? "off" : `${p.dualTask}|${p.dualLevel}`;
  $("#dualNote").textContent = running && setDual !== wantDual ? "Changes at the next set" : "";
}

// One line about each closed section, so its settings can be seen without opening it.
const SHAPE_NAMES = {
  circle: "Circle", star: "Star", heart: "Heart", diamond: "Diamond", square: "Square",
  dog: "Dog", cat: "Cat", butterfly: "Butterfly", fish: "Fish", turtle: "Turtle",
  unicorn: "Unicorn", rocket: "Rocket", goldstar: "Gold star", rainbow: "Rainbow", ball: "Ball",
};
const COLOUR_NAMES = {
  "#4da3ff": "Blue", "#3ddc84": "Green", "#ffffff": "White", "#ffd23f": "Yellow",
  "#ff8a3d": "Orange", "#ff4d6d": "Red", "#b388ff": "Purple",
};
const PATTERN_NAMES = Object.fromEntries($$(".patterns button").map((b) => [b.dataset.value, b.title]));
const BACKGROUND_NAMES = Object.fromEntries($$('[data-param="background"] button').map((b) => [b.dataset.value, b.getAttribute("aria-label")]));
const EASING_NAMES = { sine: "Smooth", linear: "Steady", jump: "Jump" };
const SOUND_NAMES = { off: "Off", click: "Click", tone: "Tone", sweep: "Sweep" };
const DUAL_NAMES = { off: "Off", flash: "Flashes", numbers: "Numbers", letters: "Letters" };
const LEVEL_NAMES = { easy: "easy", medium: "medium", hard: "hard" };
function renderSummaries(p) {
  const shape = SHAPE_NAMES[p.shape] || "";
  const picture = p.shape in EMOJI;
  const colour = COLOUR_NAMES[String(p.color).toLowerCase()] || "Custom";
  const background = BACKGROUND_NAMES[String(p.background).toLowerCase()] || "Custom";
  $("#shapeVal").textContent = shape;
  $("#colourVal").textContent = colour;
  $("#backgroundVal").textContent = background;
  $("#lightVal").textContent = p.visual === false ? "Off (sound only)"
    : [shape, picture ? "" : colour.toLowerCase(), `${p.size}%`].filter(Boolean).join(", ");
  $("#trackVal").textContent = PATTERN_NAMES[p.pattern] || "";
  $("#movementVal").textContent = EASING_NAMES[p.easing] || "";
  $("#motionVal").textContent = [PATTERN_NAMES[p.pattern], (EASING_NAMES[p.easing] || "").toLowerCase(), p.pause ? `${p.pause} ms pause` : ""].filter(Boolean).join(", ");
  $("#soundVal").textContent = p.sound === "off" ? "Off" : `${SOUND_NAMES[p.sound] || ""}, ${Math.round(p.volume * 100)}%`;
  $("#dualVal").textContent = p.dualTask === "off" ? "Off" : `${DUAL_NAMES[p.dualTask]} · ${LEVEL_NAMES[p.dualLevel] || ""}`;
  const n = state.presets.length;
  $("#presetsVal").textContent = n ? `${n} saved` : "No presets yet";
}

// ---- light or dark. "System" follows the phone's own setting (no data-theme on the page
// and nothing saved); Light or Dark is kept on this phone. The segment is in the Room sheet.
const THEME_KEY = "eyepath-theme";
const darkByDefault = matchMedia("(prefers-color-scheme: dark)");
function themeChoice() {
  try { const t = localStorage.getItem(THEME_KEY); return t === "light" || t === "dark" ? t : "system"; }
  catch (e) { return "system"; }
}
function applyTheme(choice) {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  for (const b of $$("#themeSeg button")) {
    const on = b.dataset.theme === choice;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  }
  // The browser's own bar matches the page.
  requestAnimationFrame(() => {
    $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  });
}
for (const b of $$("#themeSeg button")) {
  b.addEventListener("click", () => {
    const choice = b.dataset.theme;
    try { if (choice === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice); }
    catch (e) { /* private mode */ }
    applyTheme(choice);
  });
}
darkByDefault.addEventListener("change", () => { if (themeChoice() === "system") applyTheme("system"); });
applyTheme(themeChoice());

// An icon from the sprite, for markup made here.
function ico(name, cls = "ico") {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="${cls}" aria-hidden="true"><use href="/static/icons/sprite.svg#${name}"/></svg>`;
  return t.content.firstChild;
}

function renderStatus() {
  const chip = $("#conn");
  const show = (text, cls, title, icon) => {
    chip.className = `chip ${cls}`;
    chip.title = title;
    const mark = icon ? ico(icon) : Object.assign(document.createElement("span"), { className: "dot" });
    chip.replaceChildren(mark, text);
  };
  const room = (title, sub, icon) => {
    $("#roomConn").textContent = title;
    $("#roomConnSub").textContent = sub;
    $("#roomConnIcon").setAttribute("href", `/static/icons/sprite.svg#${icon}`);
  };
  renderOfflineToast();
  if (!connected) {
    show("Offline", "bad", "Can't reach EyePath on the computer. Reconnecting…", "wifi-slash--regular");
    return room("Can't reach EyePath", "Reconnecting…", "wifi-slash--regular");
  }
  if (!state) return;
  if (state.clients > 1) {
    show(`Connected · ${state.clients} screens`, "ok", `${state.clients} client screens are showing the light`);
    room("Connected to EyePath", `${state.clients} client screens`, "wifi-high--regular");
  } else if (state.clients > 0) {
    show("Connected", "ok", "The client screen is showing the light");
    room("Connected to EyePath", "1 client screen", "wifi-high--regular");
  } else {
    show("No light screen", "warn", "EyePath is running, but no client screen is open to show the light");
    room("Connected to EyePath", "No client screen is open to show the light", "wifi-high--regular");
  }
}

// The offline toast waits a moment, so a reconnect blip (or the first connection) doesn't flash it.
let offlineToastTimer = null;
function renderOfflineToast() {
  const toast = $("#offlineToast");
  if (connected) {
    clearTimeout(offlineToastTimer);
    offlineToastTimer = null;
    toast.hidden = true;
  } else if (!offlineToastTimer) {
    offlineToastTimer = setTimeout(() => { offlineToastTimer = null; toast.hidden = connected; }, 1500);
  }
}

function presetRow(preset, i, { handle = false, menu = false, closes = null } = {}) {
  const row = document.createElement("div");
  row.className = "preset-row";
  row.dataset.name = preset.name;
  if (handle) {
    const h = document.createElement("button");
    h.type = "button";
    h.className = "preset-handle";
    h.setAttribute("aria-label", `Drag to reorder ${preset.name}`);
    h.append(ico("dots-six-vertical--regular"));
    row.append(h);
  }
  const load = document.createElement("button");
  load.type = "button";
  load.className = "preset-load";
  const name = Object.assign(document.createElement("b"), { textContent: preset.name });
  name.append(Object.assign(document.createElement("span"), { className: "tag", textContent: "In use" }));
  const text = Object.assign(document.createElement("span"), { className: "row-text" });
  text.append(name, Object.assign(document.createElement("span"), { textContent: presetSummary(preset) }));
  load.append(Object.assign(document.createElement("span"), { className: "preset-num", textContent: String(i + 1) }), text);
  if (!menu) load.append(ico("check--fill", "ico check"));
  load.addEventListener("click", () => { sendCommand({ type: "loadPreset", name: preset.name }); if (closes) closes.close(); });
  row.append(load);
  if (menu) {
    const m = document.createElement("button");
    m.type = "button";
    m.className = "preset-menu";
    m.setAttribute("aria-label", `More for ${preset.name}`);
    m.setAttribute("aria-haspopup", "dialog");
    m.append(ico("dots-three--regular"));
    m.addEventListener("click", () => openPresetMenu(preset, i));
    row.append(m);
  }
  return row;
}

function renderPresets() {
  const box = $("#presets");
  if (!state.presets.length) {
    box.innerHTML = '<p class="help">No presets yet. Set things up, then save them here.</p>';
  } else {
    box.replaceChildren(...state.presets.map((preset, i) => presetRow(preset, i, { handle: true, menu: true })));
  }
  // The same presets in the sheet off the Session tab: tap to load, and the sheet closes.
  $("#sheetPresets").replaceChildren(...state.presets.map((preset, i) => presetRow(preset, i, { closes: $("#presetSheet") })));
  $("#sheetPresets").hidden = !state.presets.length;
  renderPresetMatch();
}

// The menu on a row: Move up, Move down, Delete, as a small sheet.
let menuPreset = null;
function openPresetMenu(preset, i) {
  const sheet = $("#presetMenuSheet");
  if (!sheet.showModal) return;
  menuPreset = preset;
  $("#presetMenuTitle").textContent = preset.name;
  $('[data-menu="up"]', sheet).disabled = i === 0;
  $('[data-menu="down"]', sheet).disabled = i === state.presets.length - 1;
  sheet.showModal();
}
for (const btn of $$("#presetMenuSheet [data-menu]")) {
  btn.addEventListener("click", async () => {
    const preset = menuPreset;
    $("#presetMenuSheet").close();
    if (!preset) return;
    const what = btn.dataset.menu;
    if (what === "delete") {
      const ok = await askConfirm(`Delete preset "${preset.name}"?`, "Delete", `delete:${preset.name}`,
        { body: "This removes it for every remote.", icon: "trash--fill" });
      if (ok) sendCommand({ type: "deletePreset", name: preset.name });
    } else {
      sendCommand({ type: "movePreset", name: preset.name, by: what === "up" ? -1 : 1 });
    }
  });
}

// Drag a row by its handle to reorder. The server moves one place at a time, so a longer
// drag becomes a few moves in a row.
(function enableDrag(list) {
  let drag = null;
  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".preset-handle");
    if (!handle || e.button !== 0) return;
    const row = handle.closest(".preset-row");
    const rows = [...list.querySelectorAll(".preset-row")];
    drag = { row, rows, from: rows.indexOf(row), to: null, y0: e.clientY, h: row.offsetHeight };
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* a pointer the browser doesn't know (synthetic) */ }
    row.classList.add("dragging");
    e.preventDefault();
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    drag.row.style.transform = `translateY(${dy}px)`;
    const to = Math.max(0, Math.min(drag.rows.length - 1, drag.from + Math.round(dy / drag.h)));
    if (to === drag.to) return;
    drag.to = to;
    drag.rows.forEach((r, i) => {
      if (r === drag.row) return;
      let shift = 0;
      if (drag.from < to && i > drag.from && i <= to) shift = -drag.h;
      else if (drag.from > to && i >= to && i < drag.from) shift = drag.h;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  });
  const release = async () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.row.classList.remove("dragging");
    for (const r of d.rows) r.style.transform = "";
    const to = d.to ?? d.from;
    const by = to > d.from ? 1 : -1;
    for (let i = 0; i < Math.abs(to - d.from); i++) {
      await sendCommand({ type: "movePreset", name: d.row.dataset.name, by }).catch(() => {});
    }
  };
  list.addEventListener("pointerup", release);
  list.addEventListener("pointercancel", release);
})($("#presets"));

// One line about a preset: speed, set length, the light when it isn't the usual blue circle, sound.
function presetSummary(preset) {
  const p = preset.params;
  const length = p.setMode === "passes" ? `${p.passes} passes` : p.setMode === "timer" ? fmtTime(p.seconds) : "no limit";
  const plain = p.shape === "circle" && String(p.color).toLowerCase() === "#4da3ff";
  const light = p.visual === false ? "light off"
    : plain ? "" : [COLOUR_NAMES[String(p.color).toLowerCase()], SHAPE_NAMES[p.shape]].filter(Boolean).join(" ").toLowerCase();
  const sound = p.sound === "off" ? "no sound" : (SOUND_NAMES[p.sound] || "").toLowerCase();
  return [`${(p.speed / 2).toFixed(2)} Hz`, length, light, sound].filter(Boolean).join(", ");
}

// The preset the current settings match exactly, if any: named in the preset bar, ticked in
// the sheet and highlighted in the list, so a tap visibly registers.
function presetMatches(preset, p) {
  return Object.entries(preset.params).every(([k, v]) =>
    (typeof v === "number" ? Math.abs(v - p[k]) < 1e-6 : v === p[k]));
}
function renderPresetMatch() {
  if (!state) return;
  const p = params();
  const match = state.presets.find((preset) => presetMatches(preset, p)) || null;
  $("#presetBarName").textContent = match ? match.name : "Custom settings";
  for (const row of $$(".preset-row")) {
    const on = !!match && row.dataset.name === match.name;
    row.classList.toggle("on", on);
    $(".preset-load", row).setAttribute("aria-pressed", on);
  }
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// The set that last finished, worked out from the server's record of it, so it's
// right even if this phone was asleep when the set ended.
// The set's total as the therapist planned it. Stop after pass shortens run.target so the light
// ends after the current pass; the counter keeps showing the planned total (none for "no limit").
const plannedTarget = (run) => (run.cleanStop ? run.plannedTarget : run.target) ?? null;

let lastSetKey = "", lastSetSummary = null;
function lastSet() {
  const run = state.lastRun;
  if (!run) return null;
  const key = `${run.id}|${run.endedAt}`;
  if (key !== lastSetKey) {
    lastSetKey = key;
    const stopped = run.status === "stopping";               // ended with Stop now
    const end = stopped ? run.stopT : (run.endT ?? run.endedAt);
    const start = stopped ? run.prev.setStartT : run.setStartT;
    const fr = Motion.frame({ params: state.params, run }, end);
    lastSetSummary = { touches: fr.touches, target: plannedTarget(stopped ? run.prev : run),
                       seconds: (end - start) / 1000, dual: Dual.shown(run, end) };
  }
  return lastSetSummary;
}

let shown = {};
function renderLive(fr, t) {
  const run = state.run;
  const p = state.params;
  const running = run.status === "running";
  const timerMode = running && p.setMode === "timer";
  const ofPasses = (target) => (target != null ? `of ${target} passes` : "passes");
  let count, sub, badge, live, elapsed, btn, btnClass, stopNow, dual, done, target, now, progress = null;
  let quick = "start", quickDone = null;
  if (running) {
    const secs = Math.max(0, (t - run.setStartT) / 1000);
    elapsed = fmtTime(secs);
    if (timerMode) { count = fmtTime(secs); sub = `of ${fmtTime(p.seconds)} · ${fr.touches} passes`; progress = secs / p.seconds; }
    else { count = String(fr.touches); sub = ofPasses(plannedTarget(run)); }
    const finishing = fr.ending || run.cleanStop;
    badge = finishing ? "Finishing" : "Running"; live = true;
    btn = finishing ? "Finishing this pass" : "Stop after this pass";
    btnClass = finishing ? "btn-go finishing" : "btn-go stop";
    stopNow = true; dual = Dual.shown(run, t);
    done = fr.touches; target = plannedTarget(run); now = !finishing;
    // Red only after Stop after pass; at a set's natural end it dims, as there is nothing left to stop.
    quick = run.cleanStop ? "now" : fr.ending ? "end" : "stop";
    quickDone = progress != null ? progress : target ? fr.touches / target : null;
  } else if (run.status === "stopping") {
    target = plannedTarget(run.prev);
    count = String(fr.touches); sub = ofPasses(target); badge = "Stopping"; live = true; elapsed = "";
    btn = "Start set"; btnClass = "btn-go"; stopNow = false; dual = Dual.shown(run, t);
    done = fr.touches; now = false;
  } else {
    const last = lastSet();
    count = last ? String(last.touches) : "0";
    target = last ? last.target : (p.setMode === "passes" ? p.passes : null);
    sub = ofPasses(target);
    badge = last ? "Set complete" : "Ready"; live = false; elapsed = last ? fmtTime(last.seconds) : "";
    btn = "Start set"; btnClass = "btn-go"; stopNow = false; dual = last && last.dual;
    done = last ? last.touches : 0; now = false;
  }
  const set = (key, value, apply) => { if (shown[key] !== value) { shown[key] = value; apply(value); } };
  set("count", count, (v) => { $("#count").textContent = v; });
  set("sub", sub, (v) => { $("#countSub").textContent = v; });
  set("badge", `${badge}|${live}`, () => { const b = $("#statusBadge"); b.textContent = badge; b.classList.toggle("live", live); });
  set("elapsed", elapsed, (v) => { $("#elapsed").textContent = v; });
  set("btn", `${btn}|${btnClass}`, () => {
    const b = $("#startBtn");
    b.className = btnClass;
    b.disabled = btnClass.includes("finishing");
    b.replaceChildren(ico(btnClass === "btn-go" ? "play--fill" : "stop--fill"), btn);
    $("#stopNowBtn").hidden = !stopNow;
  });
  set("quick", quick, renderQuickMode);
  const pct = (quick === "stop" || quick === "end") && quickDone != null ? Math.round(Math.min(1, Math.max(0, quickDone)) * 100) : null;
  set("quickRing", pct, (v) => {
    $(".quick-ring", quickGo).toggleAttribute("hidden", v == null);   // an SVG has no .hidden property
    if (v != null) $(".quick-ring .done", quickGo).style.strokeDashoffset = 100 - v;
  });
  // The chips on the preview: the track, and which set this is.
  const setChip = running || run.status === "stopping" ? `Set ${state.sets}` : state.sets ? `Set ${state.sets} done` : "";
  set("setChip", setChip, (v) => { $("#setCount").textContent = v; $("#setCount").hidden = !v; });
  set("trackChip", PATTERN_NAMES[running ? run.pattern : p.pattern] || "", (v) => { $("#trackChip").textContent = v; });
  renderRail({ progress, done, target, now });

  // Dual attention answers, live during the set and kept after it.
  let dualLabel = "", dualValues = "";
  if (dual) {
    dualLabel = (DUAL_NAMES[dual.task] || "") + (run.status === "idle" ? " · last set" : "");
    if (dual.task === "flash") dualValues = String(dual.values.length);
    else {
      const n = dual.values.length;
      dualValues = n ? `${n > 12 ? "… " : ""}${dual.values.slice(-12).join(" ")}` : "–";
    }
  }
  set("dual", `${dualLabel}|${dualValues}`, () => {
    const box = $("#dualInfo");
    box.hidden = !dualLabel;
    $(".dual-label", box).textContent = dualLabel;
    $(".dual-values", box).textContent = dualValues;
  });
  const tabText = running ? (timerMode || target == null ? count : `${fr.touches}/${target}`) : "";
  if (tabText !== tabLive.text) renderTabLive(tabText);
}

// The pass rail: one tick per pass, left to right, the current one taller; a bar for a timer
// or for very long sets; nothing for "no limit".
let rail = "";
function renderRail({ progress, done, target, now }) {
  const ticks = $("#railTicks"), bar = $("#railBar");
  const useBar = progress != null || (target != null && target > 60);
  const useTicks = !useBar && target != null;
  $("#rail").hidden = !useBar && !useTicks;
  ticks.hidden = !useTicks;
  bar.hidden = !useBar;
  if (useBar) {
    const frac = progress != null ? progress : done / target;
    const key = `bar|${Math.round(Math.min(1, Math.max(0, frac)) * 100)}`;
    if (rail !== key) { rail = key; $("i", bar).style.width = `${key.slice(4)}%`; }
    return;
  }
  if (!useTicks) { rail = ""; return; }
  const key = `ticks|${target}|${done}|${now ? 1 : 0}`;
  if (rail === key) return;
  if (!rail.startsWith(`ticks|${target}|`)) ticks.replaceChildren(...Array.from({ length: target }, () => document.createElement("i")));
  rail = key;
  const kids = ticks.children;
  for (let i = 0; i < kids.length; i++) kids[i].className = i < done ? "done" : (now && i === done ? "now" : "");
}

// ---- data
let presetsKey = "";
const pageId = Math.random().toString(36).slice(2, 12);

// When this tab closes, tell the computer so it can show the QR code again.
// (Not sent when the phone just locks or switches apps.)
addEventListener("pagehide", (e) => {
  if (e.persisted) return;
  // A beacon is the one request browsers reliably send while a page closes.
  const body = new Blob([pageId], { type: "text/plain" });
  if (!(navigator.sendBeacon && navigator.sendBeacon("/api/bye", body))) {
    fetch("/api/bye", { method: "POST", keepalive: true, body }).catch(() => {});
  }
});

const stream = connectState("therapist", (s) => {
  state = s;
  renderControls();
  renderStatus();
  renderLaptop();
  $("#appVersion").textContent = s.appVersion ? `EyePath ${s.appVersion}` : "";
  const key = JSON.stringify(s.presets.map((x) => x.name));
  if (key !== presetsKey) {
    presetsKey = key;
    renderPresets();
    // A "Delete preset?" question for a preset that has gone (e.g. deleted from another remote).
    cancelConfirm((kind) => kind.startsWith("delete:") && !s.presets.some((p) => kind === `delete:${p.name}`));
  }
}, (ok) => { connected = ok; connectionChanged(ok); renderStatus(); }, pageId);

Clock.start();

// ---- client screen controls
$("#hideCodeBtn").addEventListener("click", () => sendCommand({ type: "hideCode" }));
$("#soundCheckBtn").addEventListener("click", () => {
  sendCommand({ type: "soundCheck" });
  const label = $("#soundCheckBtn span");
  label.textContent = "Playing: left… right…";
  setTimeout(() => { label.textContent = "Test left, then right"; }, 1800);
});
$("#quitBtn").addEventListener("click", async () => {
  $("#roomSheet").close();             // the question stands on its own
  const ok = await askConfirm("Quit EyePath?", "Quit", "quit",
    { icon: "sign-out--fill" });
  if (!ok) return;
  if (!(await sendCommand({ type: "quit" }).catch(() => false))) return;
  stream.close();                      // don't keep trying to reach the app that just quit
  const n = state ? state.sets : 0;
  $("#closedSets").textContent = `Session ended after ${n} set${n === 1 ? "" : "s"}`;
  $("#closedSets").hidden = !n;
  $("#closedScreen").hidden = false;   // the tab stays open on this screen; closing it is up to the user
});

let screensKey = "";
function renderLaptop() {
  const codeShowing = state.screen === "code";
  $("#codeBanner").hidden = !codeShowing;
  $("#quitBtn").hidden = !state.laptop.canQuit;
  if (!state.laptop.canQuit) cancelConfirm((kind) => kind === "quit");
  $("#soundCheckBtn").disabled = state.run.status === "running";
  // "Show on": which screen the light is on, when more than one is connected.
  const displays = state.laptop.displays || [];
  $("#screenRow").hidden = displays.length < 2;
  const key = JSON.stringify(displays);
  if (key !== screensKey) {
    screensKey = key;
    $("#screenChoice").replaceChildren(...displays.map((d) => {
      const b = document.createElement("button");
      b.type = "button";
      const tile = Object.assign(document.createElement("span"), { className: "row-icon" });
      tile.append(ico("monitor--regular"));
      const name = Object.assign(document.createElement("span"), { className: "row-text", textContent: d.name });
      b.append(tile, name, ico("check--fill", "ico check"));
      b.classList.toggle("on", d.current);
      b.setAttribute("aria-pressed", d.current);
      b.addEventListener("click", () => sendCommand({ type: "display", id: d.id }));
      return b;
    }));
  }
}

// ---- tabs. One section at a time; the choice survives a reload (sessionStorage).
const TAB_KEY = "eyepath-tab";
let activeTab = "session";
let tabLive = { text: "", on: false };
function showTab(name) {
  if (!$(`.tab[data-tab="${name}"]`)) name = "session";
  activeTab = name;
  for (const panel of $$(".tab-panel")) panel.hidden = panel.dataset.tab !== name;
  for (const tab of $$(".tab")) {
    if (tab.dataset.tab === name) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  quickGo.hidden = name === "session";
  document.body.classList.toggle("quick-on", name !== "session");
  try { sessionStorage.setItem(TAB_KEY, name); } catch (e) { /* private mode */ }
  window.scrollTo(0, 0);
  renderTabLive();
}
for (const tab of $$(".tab")) tab.addEventListener("click", () => showTab(tab.dataset.tab));
let savedTab = "session";
try { savedTab = sessionStorage.getItem(TAB_KEY) || "session"; } catch (e) { /* private mode */ }
showTab(savedTab);

// While a set runs and another section is open, the Session item shows a dot and the count.
function renderTabLive(text = tabLive.text) {
  const on = !!text && activeTab !== "session";
  tabLive = { text, on };
  const tab = $('.tab[data-tab="session"]');
  tab.classList.toggle("live", on);
  $(".tab-label", tab).hidden = on;
  const count = $(".tab-count", tab);
  count.hidden = !on;
  count.textContent = on ? text : "";
  if (on) tab.setAttribute("aria-label", `Session, running, ${text.includes("/") ? "pass " + text.replace("/", " of ") : text}`);
  else tab.removeAttribute("aria-label");
}

// ---- bottom sheets (Room & devices). A <dialog>, so focus is trapped and goes back to the
// button that opened it. Done, the scrim, Esc or a drag down on the top closes it.
for (const sheet of $$("dialog.sheet")) {
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  $(".sheet-done", sheet).addEventListener("click", () => sheet.close());
  const grip = $(".sheet-grip", sheet);
  let dragFrom = null;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    dragFrom = e.clientY;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (dragFrom == null) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - dragFrom)}px)`;
  });
  const release = (e) => {
    if (dragFrom == null) return;
    const dy = e.clientY - dragFrom;
    dragFrom = null;
    sheet.style.transform = "";
    if (dy > 80) sheet.close();
  };
  grip.addEventListener("pointerup", release);
  grip.addEventListener("pointercancel", release);
}
$("#roomBtn").addEventListener("click", () => { const sheet = $("#roomSheet"); if (sheet.showModal) sheet.showModal(); });
$("#picturesBtn").addEventListener("click", () => { const sheet = $("#picturesSheet"); if (sheet.showModal) sheet.showModal(); });
$("#useShapeBtn").addEventListener("click", () => { setParam("shape", "circle", true); $("#picturesSheet").close(); });
$("#presetBar").addEventListener("click", () => {
  const sheet = $("#presetSheet");
  if (!sheet.showModal) return;
  $("#sheetSaveForm").hidden = true;
  $("#saveNewBtn").hidden = false;
  sheet.showModal();
});
$("#saveNewBtn").addEventListener("click", () => {
  $("#saveNewBtn").hidden = true;
  $("#sheetSaveForm").hidden = false;
  $("#sheetSaveForm input").focus();
});
$("#sheetSaveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveCurrentAs($("#sheetSaveForm input"));
  $("#sheetSaveForm").hidden = true;
  $("#saveNewBtn").hidden = false;
});

function tick(ts) {
  requestAnimationFrame(tick);
  if (!state || !Clock.ready) return;
  Clock.slew();
  const t = Clock.serverTime(ts);
  const fr = Motion.frame(state, t);
  preview.draw(state, fr);
  renderLive(fr, t);
}
requestAnimationFrame(tick);
