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
function askConfirm(question, okLabel, kind = "") {
  if (!confirmBox.showModal) return Promise.resolve(confirm(question));   // browsers too old for <dialog>
  $("#confirmTitle").textContent = question;
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

const LIMITS = { speed: [0.2, 4], passes: [1, 500], seconds: [3, 3600] };

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
    ? `<img src="/static/emoji/${v}.svg" alt="">`
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
  btn.addEventListener("click", () => step(btn.dataset.step, Number(btn.dataset.delta)));
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

$("#presetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#presetName").value.trim();
  if (!name) return;
  $("#presetName").value = "";
  await flush();           // the preset must include a change made just before saving
  sendCommand({ type: "savePreset", name });
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input:not([type=range]):not([type=checkbox]), textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (confirmBox.open) return;           // Space and Esc belong to the open question
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
  speedVal:       { param: "speed", show: (v) => `${v.toFixed(2)} sweeps/s · ${(v / 2).toFixed(2)} Hz` },
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
  el.addEventListener("click", (e) => {
    if (e.target !== el || editingNumber === id || !state) return;
    e.preventDefault();          // don't let the surrounding label grab the click
    editNumber(id);
  });
}

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
  }
  for (const group of $$("[data-param]:not(input)")) {
    const v = p[group.dataset.param];
    for (const btn of $$("button[data-value]", group)) {
      btn.classList.toggle("on", btn.dataset.value === String(v));
      btn.setAttribute("aria-pressed", btn.dataset.value === String(v));
    }
  }
  for (const btn of $$("[data-set]")) btn.classList.toggle("on", Number(btn.dataset.value) === p[btn.dataset.set]);

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
const EASING_NAMES = { sine: "Smooth", linear: "Steady", jump: "Jump" };
const SOUND_NAMES = { off: "Off", click: "Click", tone: "Tone", sweep: "Sweep" };
const DUAL_NAMES = { off: "Off", flash: "Flashes", numbers: "Numbers", letters: "Letters" };
const LEVEL_NAMES = { easy: "easy", medium: "medium", hard: "hard" };
function renderSummaries(p) {
  const shape = SHAPE_NAMES[p.shape] || "";
  const colour = p.shape in EMOJI ? "" : COLOUR_NAMES[String(p.color).toLowerCase()] || "Custom colour";
  $("#lightVal").textContent = p.visual === false ? "Off (sound only)" : [shape, colour].filter(Boolean).join(" · ");
  $("#motionVal").textContent = `${EASING_NAMES[p.easing] || ""}${p.pause ? ` · ${p.pause} ms pause` : ""}`;
  $("#soundVal").textContent = p.sound === "off" ? "Off" : `${SOUND_NAMES[p.sound] || ""} · ${Math.round(p.volume * 100)}%`;
  $("#dualVal").textContent = p.dualTask === "off" ? "Off" : `${DUAL_NAMES[p.dualTask]} · ${LEVEL_NAMES[p.dualLevel] || ""}`;
  const n = state.presets.length;
  $("#presetsVal").textContent = n ? `${n} saved` : "";
}

// ---- light or dark. Starts as the phone's own setting; the button switches, and the
// choice is kept on this phone.
const THEME_KEY = "eyepath-theme";
const darkByDefault = matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || (darkByDefault.matches ? "dark" : "light");
function applyTheme(choice) {
  document.documentElement.dataset.theme = choice;
  $("#themeBtn").setAttribute("aria-label", choice === "dark" ? "Switch to light" : "Switch to dark");
  // The browser's own bar matches the page.
  requestAnimationFrame(() => {
    $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor;
  });
}
$("#themeBtn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  applyTheme(next);
});
applyTheme(currentTheme());

function renderStatus() {
  const chip = $("#conn");
  const show = (text, cls, title) => { chip.textContent = text; chip.className = `chip ${cls}`; chip.title = title; };
  if (!connected) return show("Disconnected", "bad", "Can't reach EyePath on the computer. Reconnecting…");
  if (!state) return;
  if (state.clients > 1) show(`Connected · ${state.clients} screens`, "ok", `${state.clients} client screens are showing the light`);
  else if (state.clients > 0) show("Connected", "ok", "The client screen is showing the light");
  else show("No light screen", "warn", "EyePath is running, but no client screen is open to show the light");
}

function renderPresets() {
  const box = $("#presets");
  box.replaceChildren();
  if (!state.presets.length) {
    box.innerHTML = '<p class="help">No presets yet. Set things up, then save them here.</p>';
    return;
  }
  state.presets.forEach((preset, i) => {
    const row = document.createElement("div");
    row.className = "preset";
    const load = document.createElement("button");
    load.className = "preset-load";
    load.textContent = (i < 10 ? `${(i + 1) % 10}  ` : "") + preset.name;
    load.addEventListener("click", () => sendCommand({ type: "loadPreset", name: preset.name }));
    const del = document.createElement("button");
    del.className = "preset-del";
    del.setAttribute("aria-label", `Delete ${preset.name}`);
    del.textContent = "×";
    del.addEventListener("click", async () => {
      if (await askConfirm(`Delete preset "${preset.name}"?`, "Delete", `delete:${preset.name}`)) {
        sendCommand({ type: "deletePreset", name: preset.name });
      }
    });
    // Up and down arrows: reorder, e.g. to give a favourite one of the number keys.
    const move = (label, by, disabled) => {
      const b = document.createElement("button");
      b.className = "preset-move";
      b.textContent = label;
      b.disabled = disabled;
      b.setAttribute("aria-label", `Move ${preset.name} ${by < 0 ? "up" : "down"}`);
      b.addEventListener("click", () => sendCommand({ type: "movePreset", name: preset.name, by }));
      return b;
    };
    row.append(load, move("↑", -1, i === 0), move("↓", 1, i === state.presets.length - 1), del);
    box.append(row);
  });
  // The first three, under Start.
  const quick = $("#quickPresets");
  quick.replaceChildren(...state.presets.slice(0, 3).map((preset, i) => {
    const b = document.createElement("button");
    b.innerHTML = `<b>${i + 1}</b>`;
    b.append(preset.name);
    b.title = `Load preset: ${preset.name}`;
    b.addEventListener("click", () => sendCommand({ type: "loadPreset", name: preset.name }));
    return b;
  }));
  quick.hidden = !state.presets.length;
  renderPresetMatch();
}

// Highlight the preset(s) matching the current settings, so a tap visibly registers.
function presetMatches(preset, p) {
  return Object.entries(preset.params).every(([k, v]) =>
    (typeof v === "number" ? Math.abs(v - p[k]) < 1e-6 : v === p[k]));
}
function renderPresetMatch() {
  if (!state) return;
  const p = params();
  for (const sel of [".preset-load", "#quickPresets button"]) {
    $$(sel).forEach((btn, i) => {
      const preset = state.presets[i];
      const on = !!preset && presetMatches(preset, p);
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on);
    });
  }
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// The set that last finished, worked out from the server's record of it, so it's
// right even if this phone was asleep when the set ended.
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
    lastSetSummary = { touches: fr.touches, seconds: (end - start) / 1000, dual: Dual.shown(run, end) };
  }
  return lastSetSummary;
}

let shown = { count: null, sub: null, btn: null };
function renderLive(fr, t) {
  const run = state.run;
  const p = state.params;
  let count, sub, btn, btnClass, stopNow, dual;
  if (run.status === "running") {
    const elapsed = Math.max(0, (t - run.setStartT) / 1000);
    if (p.setMode === "timer" && !run.cleanStop) {
      count = fmtTime(elapsed);
      sub = `of ${fmtTime(p.seconds)} · ${fr.touches} passes`;
    } else {
      count = String(fr.touches);
      sub = fr.target != null ? `of ${fr.target} passes · ${fmtTime(elapsed)}` : `passes · ${fmtTime(elapsed)}`;
    }
    if (fr.ending || run.cleanStop) { btn = "Finishing…"; btnClass = "btn-go finishing"; sub += " · finishing"; }
    else { btn = "Stop"; btnClass = "btn-go stop"; }
    stopNow = true;
    dual = Dual.shown(run, t);
  } else if (run.status === "stopping") {
    count = String(fr.touches); sub = "Stopping"; btn = "Start"; btnClass = "btn-go"; stopNow = false;
    dual = Dual.shown(run, t);
  } else {
    const last = lastSet();
    count = last ? String(last.touches) : "0";
    sub = last ? `Set complete · ${fmtTime(last.seconds)}` : "Ready";
    btn = "Start"; btnClass = "btn-go"; stopNow = false;
    dual = last && last.dual;
  }
  if (count !== shown.count) { $("#count").textContent = count; shown.count = count; }
  if (sub !== shown.sub) { $("#countSub").textContent = sub; shown.sub = sub; }
  if (btn + btnClass !== shown.btn) {
    const b = $("#startBtn");
    b.textContent = btn; b.className = btnClass; shown.btn = btn + btnClass;
    $("#stopNowBtn").hidden = !stopNow;
  }

  // Dual attention answers, live during the set and kept after it.
  let info = "";
  if (dual) {
    const done = run.status === "idle" ? "Last set · " : "";
    if (dual.task === "flash") {
      info = `${done}Colour flashes: ${dual.values.length}`;
    } else {
      const n = dual.values.length;
      const list = dual.values.slice(-12).join(" ");
      info = n ? `${done}Shown (${n}): ${n > 12 ? "… " : ""}${list}` : `${done}Nothing shown yet`;
    }
  }
  if (info !== shown.info) {
    shown.info = info;
    $("#dualInfo").textContent = info;
    $("#dualInfo").hidden = !info;
  }
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
  $("#setCount").textContent = `Set ${s.sets}`;
  $("#setCount").hidden = !s.sets;
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
  const b = $("#soundCheckBtn");
  b.textContent = "Playing: left… right…";
  setTimeout(() => { b.textContent = "Test sound: left, then right"; }, 1800);
});
$("#quitBtn").addEventListener("click", async () => {
  if (!(await askConfirm("Quit EyePath?", "Quit", "quit"))) return;
  if (!(await sendCommand({ type: "quit" }).catch(() => false))) return;
  stream.close();                      // don't keep trying to reach the app that just quit
  $("#closedScreen").hidden = false;
  // Browsers only let a page close its own tab in some cases (e.g. a tab opened
  // just for the remote by scanning the QR code); otherwise the message stays.
  window.close();
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
      b.textContent = d.name;
      b.classList.toggle("on", d.current);
      b.addEventListener("click", () => sendCommand({ type: "display", id: d.id }));
      return b;
    }));
  }
}

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
