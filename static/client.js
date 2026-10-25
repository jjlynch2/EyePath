"use strict";

const $ = (id) => document.getElementById(id);
const stage = new Stage($("stage"));
const audio = new BilateralAudio();
let state = null;
let lostTimer = null;
let offline = false;          // can't reach the app for a few seconds

// No sound while the code screen covers the light or the app is unreachable.
const silent = () => offline || state.screen === "code";

// ---- connection
connectState("client", (s) => {
  state = s;
  renderScreen();
  maybeSoundCheck();
}, (ok) => {
  $("status").classList.toggle("bad", !ok);
  if (ok) {
    clearTimeout(lostTimer);
    lostTimer = null;
    offline = false;
    $("lost").hidden = true;
  } else if (!lostTimer && !offline) {
    // Failed retries repeat every second; time from the first one.
    lostTimer = setTimeout(() => { lostTimer = null; offline = true; $("lost").hidden = false; }, 4000);
  }
});
Clock.start();

// ---- code screen (until the remote connects)
let codeKey = "";
let codeShowing = false;
// The address and code are fetched when the code screen appears and every few
// seconds while it shows, not on every update (a slider drag sends many).
async function renderScreen(refresh = false) {
  const show = state.screen === "code";
  $("codeScreen").classList.toggle("gone", !show);
  const several = (state.laptop.displays || []).length > 1;
  document.querySelectorAll(".multi-screen").forEach((el) => { el.hidden = !several; });
  const appeared = show && !codeShowing;
  codeShowing = show;
  if (!show || !(appeared || refresh)) return;
  try {
    const res = await fetch("/api/code", { cache: "no-store" });
    if (res.ok) renderCode(await res.json());
  } catch (e) { /* offline; the lost-connection notice covers it */ }
}

function renderCode(info) {
  $("quitKey").textContent = info.system === "Darwin" ? "⌘Q" : "Ctrl+Q";
  const onNetwork = /^\d+\.\d+\.\d+\.\d+$/.test(info.address);
  $("addr").textContent = onNetwork ? `${info.address}:${info.port}` : "Not connected to a network";
  $("qr").hidden = !onNetwork;                     // a QR code would lead nowhere without a network
  $("code").textContent = `${info.code.slice(0, 3)}-${info.code.slice(3)}`;
  $("prefix").textContent = onNetwork ? info.address.split(".").slice(0, 3).join(".") + "." : "the same numbers";
  const key = `${info.address}|${info.pairKey}`;
  if (key !== codeKey) {
    codeKey = key;
    $("qr").src = `/api/code/qr.svg?addr=${encodeURIComponent(info.address)}&v=${encodeURIComponent(info.pairKey.slice(0, 6))}`;
  }
  const net = $("net");
  $("netRow").hidden = info.addresses.length < 2;
  if ([...net.options].map((o) => o.value).join() !== info.addresses.join()) {
    net.replaceChildren(...info.addresses.map((a) => new Option(a, a)));
  }
  net.value = info.address;
  $("fwFix").replaceChildren(
    Object.assign(document.createElement("b"), { textContent: "Allow the app through this computer's firewall. " }),
    document.createTextNode(firewallFix(info.system, info.port)));
}

function firewallFix(system, port) {
  if (system === "Windows") return "Open Start → \"Allow an app through Windows Firewall\" → Change settings, find EyePath, and tick both Private and Public. If it isn't listed, use \"Allow another app\" to add it.";
  if (system === "Darwin") return "Open System Settings → Network → Firewall → Options, and set EyePath to allow incoming connections. If the firewall is off, this isn't the problem.";
  return `Open TCP port ${port}. On Fedora: sudo firewall-cmd --add-port=${port}/tcp. If that doesn't help, your Wi-Fi may be in a different firewall zone: find it with firewall-cmd --get-active-zones and add --zone=NAME.`;
}

$("net").addEventListener("change", (e) => sendCommand({ type: "address", address: e.target.value }));
// The address can change (Wi-Fi switched, hotspot joined), so refresh while the code shows.
setInterval(() => { if (state && state.screen === "code") renderScreen(true); }, 5000);

// ---- sound check (from the remote): left ear, then right, with labels on screen
let lastCheck = null;
function maybeSoundCheck() {
  const check = state.soundCheck;
  if (!check || check.id === lastCheck) return;
  if (!Clock.ready || !audio.ready) return;            // tried again shortly (see the timer below)
  lastCheck = check.id;
  if (check.at < Clock.now() - 2000) return;          // an old one, e.g. from before this page opened
  const { toneLen, gap } = audio.playCheck(check.at, state.params);
  const startIn = check.at + state.params.audioOffset - Clock.now();
  [["checkLeft", 0], ["checkRight", gap]].forEach(([id, offset]) => {
    setTimeout(() => $(id).classList.add("on"), Math.max(0, startIn + offset * 1000));
    setTimeout(() => $(id).classList.remove("on"), Math.max(0, startIn + (offset + toneLen) * 1000));
  });
}

// ---- sound
// The app's window is full screen and allowed to play sound from the start.
// A click or key press also resumes sound if the system paused it.
const resumeSound = () => audio.unlock().catch(() => {});
resumeSound();
document.addEventListener("pointerdown", resumeSound);

// Keys on the computer, for when the phone isn't to hand (or dies mid-set).
// (F for full screen and Ctrl+Q / Cmd+Q to quit are handled by the app window.)
let localSpeed = null, localSpeedAt = 0;
document.addEventListener("keydown", (e) => {
  resumeSound();
  if (!state || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest("a, select, summary, button, input")) return;   // let links and menus work
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.code === "Space") {
    e.preventDefault();
    sendCommand({ type: state.run.status === "running" ? "stop" : "start" });   // stop finishes the sweep
  } else if (key === "Escape") {
    sendCommand({ type: "stopNow" });
  } else if (key === "ArrowUp" || key === "ArrowDown") {
    e.preventDefault();
    // Build on the last value sent, so quick or held presses all count.
    const base = localSpeed !== null && performance.now() - localSpeedAt < 1000 ? localSpeed : state.params.speed;
    localSpeed = Math.round(Math.min(4, Math.max(0.2, base + (key === "ArrowUp" ? 0.1 : -0.1))) * 100) / 100;
    localSpeedAt = performance.now();
    sendCommand({ type: "params", params: { speed: localSpeed } });
  } else if (key === "s" && (state.laptop.displays || []).length > 1) {
    sendCommand({ type: "display", id: "next" });   // move the light to the next screen
  } else if (key === "c") {
    // Show or hide the connection code, e.g. if the phone died mid-session.
    sendCommand({ type: state.screen === "code" ? "hideCode" : "showCode" });
  }
});

// Hide the cursor after it stops moving.
let cursorTimer;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("no-cursor");
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add("no-cursor"), 1500);
});

// ---- animation
function tick(ts) {
  requestAnimationFrame(tick);
  if (!state || !Clock.ready) return;
  Clock.slew();
  const t = Clock.serverTime(ts);
  stage.draw(state, Motion.frame(state, t));
  audio.update(state, silent());
}
requestAnimationFrame(tick);

// Keep sound scheduled even if frames are briefly held up, and play a sound check
// that arrived before the clock or the sound was ready.
setInterval(() => {
  if (!state || !Clock.ready) return;
  audio.update(state, silent());
  maybeSoundCheck();
}, 50);
