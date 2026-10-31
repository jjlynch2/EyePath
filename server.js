// EyePath server: an open-source light bar for EMDR.
//
// Serves two pages:
//   /client     the full-screen light the client watches (on the laptop)
//   /therapist  the remote control (on the therapist's phone)
//
// It holds one shared session and sends the whole state to every open page
// over Server-Sent Events whenever it changes. Pages animate locally from that
// state and a shared clock, so the network never touches frame timing.
//
// The Electron app (main.js) runs this. For development it also runs on its
// own:  node server.js [--port 8765] [--data DIR] [--verbose]
"use strict";

const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { makeQr } = require("./qr");
const APP_VERSION = require("./package.json").version;   // shown small on the QR screen and the remote

const STATIC = path.join(__dirname, "static");

const PREROLL_MS = 150;     // lead time so every screen starts on the same frame
const END_FADE_MS = 700;    // fade after the light settles at centre (no resting light)
const STOP_NOW_MS = 350;    // quick glide to centre on "Stop now"

const DEFAULT_PARAMS = {
  // motion
  pattern: "horizontal",  // the track; see CHOICES. Changes apply from the next set.
  track: false,           // draw the track faintly behind the ball
  speed: 2.0,             // sweeps per second, pause included (one sweep = one side to the other);
                          // 2 sweeps/s = 1 Hz (Hz = full back-and-forths per second)
  pause: 80,              // ms the light rests at each edge, taken from the sweep's time (see timing())
  easing: "sine",         // "sine" (slows at the edges), "linear" (steady) or "jump" (snaps side to side)
  travel: 90,             // % of screen width the light travels
  height: 0,              // track centre, % of screen height above (+) or below (-) the middle
  // light
  color: "#4da3ff",
  background: "#000000",
  size: 6,                // light diameter, % of screen height
  glow: true,
  shape: "circle",        // see CHOICES
  rest: true,             // show the light at centre between sets
  visual: true,           // light on/off (sound-only sets)
  // sound
  sound: "tone",          // "off", "click", "tone" or "sweep"
  pitch: 440,
  volume: 0.5,
  audioOffset: 0,         // ms; positive delays sound (wired = 0, Bluetooth ~150-250)
  balance: 0,             // -100..100; positive turns the left ear down, negative the right
  // dual attention: something to watch for while following the light
  dualTask: "off",        // "off", "flash", "numbers" or "letters". Changes apply from the next set.
  dualLevel: "medium",    // "easy", "medium" or "hard": how often something appears
  // set length
  setMode: "passes",      // "passes", "timer" or "open"
  passes: 24,
  seconds: 30,
};

// Presets a fresh install starts with. Each is a full set of settings (the
// defaults plus these changes), so switching presets never leaves stray settings.
// They are starting points, not clinical recommendations.
const STARTER_PRESETS = [
  ["Standard", {}],                                              // 1 Hz
  ["Fast · 1.2 Hz", { speed: 2.4, passes: 36, pause: 50 }],     // 1.2 Hz: from van Veen et al. (2015)
  ["Slow & short", { speed: 1.0, passes: 8, pause: 150 }],     // 0.5 Hz
  ["Sound only", { visual: false, sound: "tone" }],
  ["Gentle star", { shape: "star", color: "#ffd23f", speed: 1.6, passes: 16, size: 8 }],  // 0.8 Hz
];

function starterPresets() {
  // Starter presets leave sound delay and balance as they are (they suit the headphones and the
  // client, not the preset); presets the therapist saves include them.
  const { audioOffset, balance, ...base } = DEFAULT_PARAMS;
  return STARTER_PRESETS.map(([name, changes]) => ({ name, params: { ...base, ...changes } }));
}

const LIMITS = {
  speed: [0.2, 4.0], pause: [0, 1000], travel: [30, 100], height: [-40, 40], size: [1, 30],
  pitch: [100, 1200], volume: [0, 1], audioOffset: [-300, 600], balance: [-100, 100], passes: [1, 500], seconds: [3, 3600],
};
const WHOLE_NUMBERS = new Set(["pause", "travel", "height", "pitch", "audioOffset", "balance", "passes", "seconds"]);
const CHOICES = {
  pattern: ["horizontal", "vertical", "diagUp", "diagDown", "figure8", "figure8r", "oval", "ovalr"],
  easing: ["sine", "linear", "jump"],
  shape: ["circle", "star", "heart", "diamond", "square",
          "dog", "cat", "butterfly", "fish", "turtle", "unicorn", "rocket", "goldstar", "rainbow", "ball"],
  sound: ["off", "click", "tone", "sweep"],
  setMode: ["passes", "timer", "open"],
  dualTask: ["off", "flash", "numbers", "letters"],
  dualLevel: ["easy", "medium", "hard"],
};
const MOTION_KEYS = ["speed", "pause", "easing"];

// Server time in ms, with sub-millisecond precision for clock sync.
const nowMs = () => performance.timeOrigin + performance.now();

// ---------------------------------------------------------------- motion math
// Mirrors static/common.js. Phase counts periods: one period is one sweep plus
// the edge pause. Touch k (the light reaching an edge) happens at phase
// k + moveFrac. A set starts at the resting point (phase moveFrac/2). With a
// target of N touches, the light glides back to rest during [N, N + moveFrac/2].

// "jump" stays put and snaps across at the end of the sweep (saccades), so the
// jump lands exactly when the ball "reaches" the side and the tone plays.
const ease = (name, u) => (name === "sine" ? (1 - Math.cos(Math.PI * u)) / 2 : name === "jump" ? (u >= 1 ? 1 : 0) : u);
const invEase = (name, p) => {
  p = Math.min(1, Math.max(0, p));
  if (name === "jump") return p >= 0.5 ? 1 : 0;
  return name === "sine" ? Math.acos(1 - 2 * p) / Math.PI : p;
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Speed sets the rhythm: one sweep, including its pause at the edge, takes 1/speed
// seconds, so 2 sweeps/s is exactly 1 Hz (one left-right-left cycle per second) whatever
// the pause. The pause comes out of the sweep's time, up to half of it, so the light
// always has time to move.
const MAX_PAUSE_SHARE = 0.5;
function timing(params) {
  const period = 1 / params.speed;
  const pause = Math.min(params.pause / 1000, period * MAX_PAUSE_SHARE);
  return { rate: params.speed, moveFrac: (period - pause) / period };
}

const phaseAt = (run, t) =>
  t <= run.anchorT ? run.anchorPhase : run.anchorPhase + ((t - run.anchorT) / 1000) * run.rate;
const timeAtPhase = (run, phi) => run.anchorT + ((phi - run.anchorPhase) / run.rate) * 1000;

// Phase under new timing that keeps the light where it is right now.
function remapPhase(run, phi, mfNew, eNew) {
  const mf = run.moveFrac, eOld = run.easing, n = run.target;
  if (n !== null && phi >= n) {
    const u = clamp01((phi - n) / (mf / 2));
    return n + (invEase(eNew, ease(eOld, u)) * mfNew) / 2;
  }
  if (phi < mf) {
    const u = clamp01((phi - mf / 2) / (mf / 2));
    return mfNew / 2 + (invEase(eNew, ease(eOld, u)) * mfNew) / 2;
  }
  const k = Math.floor(phi), f = phi - k;
  if (f < mf) return k + invEase(eNew, ease(eOld, f / mf)) * mfNew;
  const g = mf < 1 ? (f - mf) / (1 - mf) : 0;
  return k + mfNew + g * (1 - mfNew);
}

// Keep only known keys with valid values, clamped to their limits; drop unchanged ones.
function cleanParams(raw, current) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(DEFAULT_PARAMS, key)) continue;   // not "in": that also matches "constructor" etc.
    const def = DEFAULT_PARAMS[key];
    let v;
    if (Object.hasOwn(CHOICES, key)) {
      if (CHOICES[key].includes(value)) v = value;
    } else if (typeof def === "boolean") {
      v = !!value;
    } else if (key === "color" || key === "background") {
      if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) v = value.toLowerCase();
    } else if (typeof def === "number") {
      let n = Number(value);
      if (value === null || value === "" || typeof value === "boolean" || !Number.isFinite(n)) continue;
      const [lo, hi] = LIMITS[key];
      n = Math.min(hi, Math.max(lo, n));
      v = WHOLE_NUMBERS.has(key) ? Math.round(n) : n;
    }
    if (v !== undefined && current[key] !== v) out[key] = v;
  }
  return out;
}

const validPreset = (p) => p && typeof p === "object" && typeof p.name === "string" &&
  p.params && typeof p.params === "object";

// ---------------------------------------------------------------- session

class Session {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.params = { ...DEFAULT_PARAMS };
    this.presets = [];
    this.run = { status: "idle" };
    this.subscribers = new Map();   // response -> { role, pageId }
    this.recentRemotes = new Map(); // pageId -> when its connection closed
    this.idleTimer = null;
    this.idleToken = null;
    // What the laptop's client screen shows: the connection code until a
    // remote connects, then the light. At startup any remote connecting hides
    // the code (it has just paired, or it is the remote on this laptop). When the code is shown on purpose,
    // only a newly paired device hides it, so a phone that merely reconnects
    // after its screen locked doesn't.
    this.screen = "code";
    this.codeHidesOnConnect = true;
    this.codeWhenIdle = false;      // show the code once the current set ends
    this.setCount = 0;              // sets started since the app opened (never saved)
    this.extraState = null;         // function adding the laptop's settings to the state
    this.load();
  }

  // ---- persistence
  load() {
    this.startersAdded = false;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.dataDir, "settings.json"), "utf8"));
      Object.assign(this.params, cleanParams(saved.params || {}, this.params));
      this.presets = (saved.presets || []).filter(validPreset);
      this.startersAdded = !!saved.startersAdded;
    } catch (err) {
      if (err.code !== "ENOENT") console.log(`Could not read saved settings (${err.message}); using defaults.`);
    }
    // Add the starter presets once. Deleted ones stay deleted.
    if (!this.startersAdded) {
      if (!this.presets.length) this.presets = starterPresets();
      this.startersAdded = true;
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const file = path.join(this.dataDir, "settings.json");
      fs.writeFileSync(file + ".tmp", JSON.stringify(
        { params: this.params, presets: this.presets, startersAdded: this.startersAdded }, null, 2));
      fs.renameSync(file + ".tmp", file);
    } catch (err) {
      console.log(`Could not save settings: ${err.message}`);
    }
  }

  // ---- broadcasting
  count(role) {
    let n = 0;
    for (const s of this.subscribers.values()) if (s.role === role) n++;
    return n;
  }

  snapshot() {
    return {
      appVersion: APP_VERSION, params: this.params, run: this.run, lastRun: this.lastRun || null, presets: this.presets,
      clients: this.count("client"), screen: this.screen,
      sets: this.setCount, laptop: this.extraState ? this.extraState() : {}, soundCheck: this.soundCheck || null,
    };
  }

  // Save half a second after the last change (a slider drag sends many), and on quit.
  saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 500);
  }

  flushSave() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  changed(save = false) {
    if (save) this.saveSoon();
    const msg = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const res of this.subscribers.keys()) res.write(msg);
  }

  subscribe(res, role, pageId) {
    this.subscribers.set(res, { role, pageId });
    if (role === "therapist") {
      this.codeWhenIdle = false;
      if (this.codeHidesOnConnect) this.screen = "light";   // a remote is connected; show the light
    }
    this.changed();
  }

  unsubscribe(res) {
    const sub = this.subscribers.get(res);
    if (!sub) return;
    this.subscribers.delete(res);
    // A closing tab's goodbye can arrive just after its connection drops.
    if (sub.role === "therapist" && sub.pageId) this.recentRemotes.set(sub.pageId, Date.now());
    this.changed();
  }

  // End a connection from our side (its "close" handler then finds it gone).
  drop(res) {
    this.subscribers.delete(res);
    res.end();
  }

  // A remote tab is closing. If no remote is back shortly (a reload comes
  // straight back), show the connection code: now if idle, else after the set.
  remoteClosing(pageId) {
    if (!pageId) return;
    const matched = [...this.subscribers].filter(([, s]) => s.role === "therapist" && s.pageId === pageId);
    for (const [id, t] of [...this.recentRemotes]) if (Date.now() - t > 10000) this.recentRemotes.delete(id);
    const justClosed = this.recentRemotes.has(pageId);
    if (!matched.length && !justClosed) return;    // only a (just) connected remote can say goodbye
    if (matched.length) {
      for (const [res] of matched) this.drop(res); // end that connection now
      this.changed();
    }
    setTimeout(() => {
      if (this.count("therapist") > 0) return;
      if (this.run.status === "idle") this.showCodeUntilReconnect();
      else this.codeWhenIdle = true;
    }, 3000);
  }

  showCodeUntilReconnect() {
    this.screen = "code";
    this.codeHidesOnConnect = true;         // any remote coming back shows the light again
    this.codeWhenIdle = false;
    this.changed();
  }

  setScreen(screen) {
    if (screen !== "code" && screen !== "light") return;
    this.screen = screen;
    this.codeHidesOnConnect = false;
    this.changed();
  }

  // ---- run control
  scheduleIdle(atMs) {
    clearTimeout(this.idleTimer);
    // Only the most recently scheduled end counts. (Other changes during the
    // set, like volume or a device connecting, must not cancel it.)
    const token = {};
    this.idleToken = token;
    this.idleTimer = setTimeout(() => {
      if (this.idleToken !== token || this.run.status === "idle") return;
      // Kept so a remote that was asleep when the set ended can still show its summary.
      this.lastRun = { ...this.run, endedAt: nowMs() };
      this.run = { status: "idle" };
      if (this.codeWhenIdle && this.count("therapist") === 0) this.showCodeUntilReconnect();
      else this.changed();
    }, Math.max(0, atMs - nowMs()));
  }

  scheduleEnd() {
    const run = this.run;
    if (run.status !== "running" || run.target === null) {
      clearTimeout(this.idleTimer);
      this.idleToken = null;
      if (run.status === "running") run.endT = null;   // e.g. switched to "No limit" mid-set
      return;
    }
    const settle = timeAtPhase(run, run.target + run.moveFrac / 2);
    run.endT = settle;
    this.scheduleIdle(settle + (this.params.rest ? 0 : END_FADE_MS) + 50);
  }

  // The oval's glide home ends at the top after an even number of touches and
  // at the bottom after an odd one; the ball rests at the top.
  static fitTarget(run, n) {
    n = Math.max(1, n);
    return (run.pattern === "oval" || run.pattern === "ovalr") && n % 2 ? n + 1 : n;
  }

  // Touch count that ends the set, or null for an open set.
  targetFor(run, phi, t) {
    const mode = this.params.setMode;
    const floorTarget = Math.floor(phi) + 1;   // never end in the middle of a sweep
    if (mode === "open") return null;
    if (mode === "passes") return Session.fitTarget(run, Math.max(this.params.passes, floorTarget));
    const remaining = this.params.seconds - (t - run.setStartT) / 1000;
    const n = Math.floor(phi + remaining * run.rate - run.moveFrac) + 1;
    return Session.fitTarget(run, Math.max(n, floorTarget));
  }

  start() {
    if (this.run.status === "running") return;
    const { rate, moveFrac } = timing(this.params);
    const t0 = nowMs() + PREROLL_MS;
    this.run = {
      status: "running", id: crypto.randomBytes(4).toString("hex"),
      anchorT: t0, anchorPhase: moveFrac / 2, rate, moveFrac,
      easing: this.params.easing, pattern: this.params.pattern, target: null,
      setStartT: t0, endT: null, cleanStop: false,
      // Fixed for the whole set so every screen shows (and the remote lists) the same things.
      dual: this.params.dualTask === "off" ? null
        : { task: this.params.dualTask, level: this.params.dualLevel, seed: crypto.randomInt(2 ** 31) },
    };
    this.run.target = this.targetFor(this.run, moveFrac / 2, t0);
    this.setCount++;
    // Started from the computer's keys while the code shows and no phone is connected
    // (e.g. to try the light): show the code again when the set ends.
    if (this.screen === "code" && this.count("therapist") === 0) this.codeWhenIdle = true;
    this.screen = "light";
    this.codeHidesOnConnect = false;
    this.scheduleEnd();
    this.changed();
  }

  // Finish the current sweep, then glide to centre.
  stop() {
    const run = this.run;
    if (run.status !== "running") return;
    const phi = phaseAt(run, nowMs());
    if (run.target !== null && phi >= run.target) return;   // already gliding home
    run.target = Session.fitTarget(run, Math.floor(phi) + 1);
    run.cleanStop = true;
    this.scheduleEnd();
    this.changed();
  }

  // Quick glide to centre from wherever the light is.
  stopNow() {
    const run = this.run;
    if (run.status !== "running") return;
    const t = nowMs();
    const { prev, ...rest } = run;
    this.run = { status: "stopping", id: run.id, stopT: t, prev: rest };
    this.scheduleIdle(t + STOP_NOW_MS + 50);
    this.changed();
  }

  updateParams(raw) {
    const changes = cleanParams(raw, this.params);
    if (!Object.keys(changes).length) return;
    const p = this.params;
    const oldMode = [p.setMode, p.passes, p.seconds].join();
    Object.assign(p, changes);
    const run = this.run;
    if (run.status === "running") {
      const t = nowMs();
      if (MOTION_KEYS.some((k) => k in changes)) {
        const phi = phaseAt(run, t);
        const { rate, moveFrac } = timing(p);
        const newPhi = remapPhase(run, phi, moveFrac, p.easing);
        if (t < run.anchorT) run.anchorPhase = moveFrac / 2;
        else { run.anchorT = t; run.anchorPhase = newPhi; }
        Object.assign(run, { rate, moveFrac, easing: p.easing });
      }
      const phi = phaseAt(run, t);
      const ending = run.target !== null && phi >= run.target;
      const timerRescale = p.setMode === "timer" && ("speed" in changes || "pause" in changes);
      const newMode = [p.setMode, p.passes, p.seconds].join();
      if (!run.cleanStop && !ending && (newMode !== oldMode || timerRescale)) run.target = this.targetFor(run, phi, t);
      this.scheduleEnd();
    }
    this.changed(true);
  }

  savePreset(name) {
    name = String(name ?? "").trim().slice(0, 40);
    if (!name) return;
    const params = { ...this.params };   // everything, including sound delay and balance (per-client tuning)
    const preset = { name, params };
    const i = this.presets.findIndex((x) => x.name === name);
    if (i >= 0) this.presets[i] = preset;   // re-saving keeps its place (and number key)
    else this.presets.push(preset);
    this.changed(true);
  }

  deletePreset(name) {
    this.presets = this.presets.filter((x) => x.name !== name);
    this.changed(true);
  }

  // Move a preset one place up (by = -1) or down (1); the first ten load with keys 1-9 and 0.
  movePreset(name, by) {
    if (by !== -1 && by !== 1) return;
    const i = this.presets.findIndex((x) => x.name === name);
    const j = i + by;
    if (i < 0 || j < 0 || j >= this.presets.length) return;
    [this.presets[i], this.presets[j]] = [this.presets[j], this.presets[i]];
    this.changed(true);
  }
}

// ---------------------------------------------------------------- pairing

// Who may use the app from another device. The computer running the app is
// always allowed. Other devices pair by opening /pair?k=<key> (what the QR
// code contains) or by typing the 6-character code; either sets a signed cookie.
//
// Nothing is saved: every time the app starts there is a new key, code and
// signing secret, so no device stays connected from an earlier session.
class Auth {
  static COOKIE = "eyepath_session";
  // How long the phone's browser keeps the cookie. The app accepts it for as long as
  // it keeps running (a clinic may leave it on for days); quitting ends it, because
  // the next launch has a new signing secret.
  static MAX_AGE = 30 * 24 * 3600;
  static CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0/O, 1/I/L

  constructor() {
    this.secret = crypto.randomBytes(32);
    this.pairKey = Auth.newKey();
    this.pairCode = Auth.newCode();
    this.failures = new Map();   // ip -> { count, first }
    this.totalFailures = [];     // times of recent failures from anywhere
  }

  static newKey() { return crypto.randomBytes(16).toString("base64url"); }
  static newCode() {
    return Array.from({ length: 6 }, () => Auth.CODE_CHARS[crypto.randomInt(Auth.CODE_CHARS.length)]).join("");
  }

  checkPairKey(key) { return !!key && safeEqual(key, this.pairKey); }

  sign(issued) {
    const key = Buffer.concat([this.secret, crypto.createHash("sha256").update(this.pairKey).digest()]);
    return crypto.createHmac("sha256", key).update(issued).digest("hex");
  }

  token() {
    const issued = String(Math.floor(Date.now() / 1000));
    return `${issued}.${this.sign(issued)}`;
  }

  valid(cookieHeader) {
    for (const part of (cookieHeader || "").split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name !== Auth.COOKIE) continue;
      const [issued, sig] = rest.join("=").split(".");
      if (/^\d+$/.test(issued || "") && sig && safeEqual(sig, this.sign(issued))) return true;
    }
    return false;
  }

  // True if attempt is the typed pairing code. Limited to 10 wrong tries per
  // device and 50 overall per 10 minutes, so the code cannot be guessed.
  checkLogin(ip, attempt) {
    const now = Date.now() / 1000;
    let f = this.failures.get(ip) || { count: 0, first: now };
    if (now - f.first > 600) f = { count: 0, first: now };
    this.totalFailures = this.totalFailures.filter((t) => now - t < 600);
    if (f.count >= 10 || this.totalFailures.length >= 50) return false;
    const code = String(attempt || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const ok = code.length === 6 && safeEqual(code, this.pairCode);
    if (ok) this.failures.delete(ip);
    else { this.failures.set(ip, { count: f.count + 1, first: f.first }); this.totalFailures.push(now); }
    return ok;
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- laptop

// The computer running the app: its connection code and quit. The code screen
// (QR code, address, typed code) is only ever served to this computer.
class Laptop {
  constructor(app) {
    this.app = app;
    this.file = path.join(app.dataDir, "app.json");
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* missing or unreadable */ }
    this.prefs = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    this.onQuit = null;           // these three are set by the Electron app
    this.getDisplays = null;
    this.onChooseDisplay = null;
    app.session.extraState = () => ({ canQuit: !!this.onQuit, displays: this.getDisplays ? this.getDisplays() : [] });
  }

  savePrefs() {
    try {
      fs.mkdirSync(this.app.dataDir, { recursive: true });
      // Write a new file, then swap it in, so a crash mid-write can't leave half a file.
      fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.prefs, null, 2), { mode: 0o600 });
      fs.renameSync(this.file + ".tmp", this.file);
    } catch { /* not saved */ }
  }

  pairUrl(addr) { return `http://${addr}:${this.app.port}/pair?k=${this.app.auth.pairKey}`; }

  async info() {
    const addresses = await lanAddresses();
    let address = this.prefs.address;
    if (!addresses.includes(address)) address = addresses[0] || "localhost";
    const system = { win32: "Windows", darwin: "Darwin" }[process.platform] || "Linux";
    return { port: this.app.port, addresses, address, pairKey: this.app.auth.pairKey, code: this.app.auth.pairCode, system };
  }

  async qrSvg(addr) {
    const info = await this.info();
    if (!info.addresses.includes(addr)) addr = info.address;
    const matrix = makeQr(this.pairUrl(addr));
    const n = matrix.length + 8;
    let d = "";
    matrix.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        if (!row[x]) { x++; continue; }
        const start = x;
        while (x < row.length && row[x]) x++;
        d += `M${start + 4} ${y + 4}h${x - start}v1h${start - x}z`;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
      `<rect width="${n}" height="${n}" fill="#e6f0f0"/><path d="${d}" fill="#0f2a2e"/></svg>`;   // tinted to match the screen; still high contrast for scanners
  }

  setAddress(addr) {
    this.prefs.address = String(addr);
    this.savePrefs();
    this.app.session.changed();   // the code screen picks up the new address
  }

  quit() {
    if (this.onQuit) setTimeout(this.onQuit, 300);
  }
}

// This computer's network addresses, the one used for Wi-Fi/LAN first.
async function lanAddresses() {
  const primary = await new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const done = (addr) => { try { sock.close(); } catch { /* closed */ } resolve(addr); };
    sock.on("error", () => done(null));
    // No packets are sent; connecting just picks the outward interface.
    sock.connect(80, "192.0.2.1", (err) => {
      if (err) return done(null);                  // no route (offline, or a network without a gateway)
      try {
        const addr = sock.address().address;
        done(addr && addr !== "0.0.0.0" ? addr : null);
      } catch { done(null); }
    });
  });
  const others = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === "IPv4" || a.family === 4) && !a.internal) others.push(a.address);
    }
  }
  const all = [...new Set([primary, ...others.sort()].filter(Boolean))];
  return all.filter((a) => !a.startsWith("127.") && !a.startsWith("169.254."));
}

// ---------------------------------------------------------------- HTTP

const PAGES = { "/client": "client.html", "/therapist": "therapist.html" };
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};
const LOCAL_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function makeHandler(app) {
  const { session, auth, laptop } = app;

  return async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const urlPath = url.pathname.replace(/\/+$/, "") || "/";
    const q = url.searchParams;
    if (app.verbose) console.log(`${req.socket.remoteAddress} ${req.method} ${req.url}`);

    const send = (code, body, type, extra = {}) => {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      res.writeHead(code, {
        "Content-Type": type, "Content-Length": buf.length, "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra,
      });
      res.end(req.method === "HEAD" ? undefined : buf);
    };
    const json = (obj, code = 200) => send(code, JSON.stringify(obj), "application/json");
    const redirect = (where, extra = {}) => send(303, "", "text/plain", { Location: where, ...extra });
    const serveFile = (name) => {
      const file = path.resolve(STATIC, name);
      if (!file.startsWith(STATIC + path.sep)) return send(404, "Not found", "text/plain");
      fs.readFile(file, (err, data) => {
        if (err) return send(404, "Not found", "text/plain");
        send(200, data, TYPES[path.extname(file)] || "application/octet-stream");
      });
    };
    const cookie = () => `${Auth.COOKIE}=${auth.token()}; Max-Age=${Auth.MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`;

    // A request from the computer running the app, addressed to it by name. The
    // Host check stops other web pages reaching the app through a domain that
    // points at this computer.
    const isLocal = () => {
      if (!LOCAL_ADDRESSES.has(req.socket.remoteAddress)) return false;
      const host = (req.headers.host || "").replace(/:\d+$/, "");
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    };
    // The computer running the app never needs to pair.
    const authed = () => isLocal() || auth.valid(req.headers.cookie);

    if (req.method === "GET" || req.method === "HEAD") {
      if (urlPath === "/healthz") return send(200, "eyepath-ok", "text/plain");
      if (urlPath === "/api/code" || urlPath === "/api/code/qr.svg") {
        // The connection code is only ever shown on the computer running the app.
        if (!isLocal()) return json({ error: "only available on the computer running the app" }, 403);
        if (urlPath === "/api/code") return json(await laptop.info());
        return send(200, await laptop.qrSvg(q.get("addr") || ""), "image/svg+xml");
      }
      if (urlPath === "/login") return serveFile("login.html");
      if (urlPath === "/pair") {
        const next = q.get("next") || "/therapist";
        if (auth.checkPairKey(q.get("k") || "")) {
          session.setScreen("light");          // a new device paired; show the light
          return redirect(Object.hasOwn(PAGES, next) ? next : "/therapist", { "Set-Cookie": cookie() });
        }
        return redirect("/login?expired=1");
      }
      // Answered before pairing so clock sync is as quick as possible; it reveals nothing.
      if (urlPath === "/api/time") return json({ t: nowMs() });
      if (urlPath.startsWith("/static/") && /\.(css|svg|png|woff2)$/.test(urlPath)) return serveFile(urlPath.slice(8));   // styles, icons and fonts

      if (!authed()) {
        if (urlPath.startsWith("/api/")) return json({ error: "login required" }, 401);
        return redirect("/login?next=/therapist");
      }
      // The light screen is the laptop's; other devices get the remote.
      if (urlPath === "/") return redirect(isLocal() ? "/client" : "/therapist");
      if (urlPath === "/client" && !isLocal()) return redirect("/therapist");
      if (PAGES[urlPath]) return serveFile(PAGES[urlPath]);
      if (urlPath.startsWith("/static/")) return serveFile(urlPath.slice(8));
      if (urlPath === "/api/events") {
        const role = ["client", "therapist"].includes(q.get("role")) ? q.get("role") : "other";
        const pageId = (q.get("id") || "").slice(0, 40);
        res.writeHead(200, {
          "Content-Type": "text/event-stream", "Cache-Control": "no-store",
          "X-Accel-Buffering": "no", Connection: "keep-alive",
        });
        res.write("retry: 1000\n\n");
        session.subscribe(res, role, pageId);
        const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15000);
        req.on("close", () => { clearInterval(keepAlive); session.unsubscribe(res); });
        return;
      }
      if (urlPath === "/api/info") return json({ urls: (await lanAddresses()).map((a) => `http://${a}:${app.port}`), auth: true });
      return send(404, "Not found", "text/plain");
    }

    if (req.method !== "POST") return send(405, "Method not allowed", "text/plain");
    let body;
    try {
      body = await readBody(req, 65536);
    } catch {
      return json({ error: "too large" }, 413);
    }

    if (urlPath === "/login") {
      const form = new URLSearchParams(body);
      let next = form.get("next") || "/therapist";
      if (!Object.hasOwn(PAGES, next)) next = "/therapist";   // not PAGES[next]: "constructor" etc. would pass
      if (auth.checkLogin(req.socket.remoteAddress, form.get("code") || "")) {
        session.setScreen("light");            // a new device paired; show the light
        return redirect(next, { "Set-Cookie": cookie() });
      }
      return setTimeout(() => redirect(`/login?next=${next}&bad=1`), 1000);
    }
    if (!authed()) return json({ error: "login required" }, 401);
    if (urlPath === "/api/bye") {
      // Sent by a closing remote tab (navigator.sendBeacon, plain text: its page id).
      session.remoteClosing(body.trim().slice(0, 40));
      return send(204, "", "text/plain");
    }
    if (urlPath !== "/api/command") return json({ error: "not found" }, 404);
    // Reject cross-site form posts (JSON only).
    if (!(req.headers["content-type"] || "").startsWith("application/json")) return json({ error: "expected JSON" }, 415);
    let cmd;
    try {
      cmd = JSON.parse(body || "{}");
    } catch {
      return json({ error: "bad JSON" }, 400);
    }
    if (!cmd || typeof cmd !== "object") return json({ error: "bad JSON" }, 400);

    const localOnly = () => json({ error: "only available on the computer running the app" }, 403);
    switch (cmd.type) {
      case "showCode": if (!isLocal()) return localOnly(); session.setScreen("code"); break;
      case "hideCode": session.setScreen("light"); break;
      case "quit": laptop.quit(); break;
      case "display": if (laptop.onChooseDisplay) laptop.onChooseDisplay(String(cmd.id || "")); break;
      case "address": if (!isLocal()) return localOnly(); laptop.setAddress(cmd.address || ""); break;
      case "start": session.start(); break;
      case "stop": session.stop(); break;
      case "stopNow": session.stopNow(); break;
      case "soundCheck":
        // Left ear, then right ear, starting shortly so every screen plays it at the same moment.
        if (session.run.status !== "running") {
          session.soundCheck = { id: crypto.randomBytes(4).toString("hex"), at: nowMs() + 300 };
          session.changed();
        }
        break;
      case "params": session.updateParams(cmd.params); break;
      case "savePreset": session.savePreset(cmd.name); break;
      case "deletePreset": session.deletePreset(cmd.name); break;
      case "movePreset": session.movePreset(String(cmd.name ?? ""), Number(cmd.by)); break;
      case "loadPreset": {
        const match = session.presets.find((x) => x.name === cmd.name);
        if (match) session.updateParams(match.params);
        break;
      }
      default: return json({ error: "unknown command" }, 400);
    }
    return json({ ok: true });
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Start the server on the first free port from `port`. Resolves to the app object.
async function createServer({ dataDir, port = 8765, portTries = 20, verbose = false } = {}) {
  const app = { dataDir, verbose, port: null };
  app.session = new Session(dataDir);
  app.auth = new Auth();
  // Pairing files saved by earlier versions are no longer used.
  for (const f of ["secret.key", "pair.key", "pair.code"]) fs.rm(path.join(dataDir, f), { force: true }, () => {});
  app.laptop = new Laptop(app);
  const handle = makeHandler(app);
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) { res.writeHead(500); res.end("Server error"); }
    });
  });
  for (let i = 0; i < portTries; i++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port + i, "0.0.0.0", () => { server.off("error", reject); resolve(); });
      });
      app.port = port + i;
      break;
    } catch (err) {
      if (err.code !== "EADDRINUSE" || i === portTries - 1) throw err;
    }
  }
  app.server = server;
  app.close = () => new Promise((resolve) => {
    app.session.flushSave();
    for (const res of [...app.session.subscribers.keys()]) app.session.drop(res);
    server.close(() => resolve());
  });
  return app;
}

module.exports = {
  createServer, lanAddresses,
  // For the tests in test/ only.
  internals: { timing, ease, phaseAt, timeAtPhase, remapPhase, cleanParams, starterPresets, Session,
               DEFAULT_PARAMS, END_FADE_MS, STOP_NOW_MS },
};

// ---------------------------------------------------------------- run on its own
if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  createServer({
    dataDir: path.resolve(opt("--data", process.env.EYEPATH_DATA_DIR || path.join(__dirname, "data"))),
    port: Number(opt("--port", 8765)),
    portTries: 1,
    verbose: args.includes("--verbose"),
  }).then(async (app) => {
    console.log("EyePath running.");
    console.log(`  Laptop screen (shows the QR code until a remote connects):  http://localhost:${app.port}/client`);
    for (const a of await lanAddresses()) console.log(`  Other devices:  http://${a}:${app.port}   code ${app.auth.pairCode}`);
    const stop = () => app.close().then(() => process.exit(0));   // saves any last change first
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }).catch((err) => {
    console.error(`Could not start: ${err.message}`);
    process.exit(1);
  });
}
