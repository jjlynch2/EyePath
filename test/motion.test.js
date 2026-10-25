// Tests for the timing and motion maths, the settings checks and the dual-attention
// sequences. Run with `npm test` (Node's built-in test runner, nothing to install).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const { timing, ease, phaseAt, timeAtPhase, remapPhase, cleanParams, starterPresets, Session,
        DEFAULT_PARAMS, END_FADE_MS, STOP_NOW_MS } = require(path.join(root, "server.js")).internals;

// The screens' copy of the maths (static/common.js), loaded as the browser would.
function loadScreenCode() {
  const code = fs.readFileSync(path.join(root, "static", "common.js"), "utf8");
  const context = vm.createContext({ performance, console, setInterval, setTimeout, clearTimeout });
  return vm.runInContext(`${code}\n;({ Motion, Dual })`, context);
}
const { Motion, Dual } = loadScreenCode();

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const hz = (params) => timing(params).rate / 2;            // sweeps per second -> left-right-left cycles per second

// A running set as the server makes it, starting at time 0.
function makeRun(params, extra = {}) {
  const { rate, moveFrac } = timing(params);
  return { status: "running", id: "t", anchorT: 0, anchorPhase: moveFrac / 2, rate, moveFrac,
           easing: params.easing, pattern: params.pattern, target: null, setStartT: 0, endT: null, ...extra };
}

// Where the light is at phase phi of a run, using the screens' code.
function position(run, phi) {
  const sw = Motion.sweepAt(run, phi);
  const pt = Motion.point(run.pattern, sw.k, sw.p);
  return [pt.X, pt.Y];
}

test("speed is the real rhythm: 2 sweeps/s is 1 Hz whatever the edge pause", () => {
  for (const pause of [0, 50, 80, 150, 400]) {
    assert.equal(hz({ speed: 2, pause }), 1, `pause ${pause} ms`);
  }
});

test("the edge pause comes out of each sweep, at most half of it", () => {
  assert.ok(close(timing({ speed: 2, pause: 80 }).moveFrac, 0.84));   // 420 ms moving + 80 ms pause
  assert.equal(timing({ speed: 2, pause: 0 }).moveFrac, 1);
  assert.equal(timing({ speed: 4, pause: 1000 }).moveFrac, 0.5);       // capped: 125 ms + 125 ms
});

test("the default and the starter presets run at the speed their names and notes say", () => {
  assert.equal(hz(DEFAULT_PARAMS), 1);
  const presets = Object.fromEntries(starterPresets().map((p) => [p.name, { ...DEFAULT_PARAMS, ...p.params }]));
  assert.ok(close(hz(presets["Fast · 1.2 Hz"]), 1.2));
  assert.equal(hz(presets["Slow & short"]), 0.5);
  assert.ok(close(hz(presets["Gentle star"]), 0.8));
  assert.equal(hz(presets.Standard), 1);
});

test("a 24-pass set at 1 Hz lasts 12 seconds", () => {
  const run = makeRun(DEFAULT_PARAMS, { target: 24 });
  assert.ok(close(timeAtPhase(run, 24 + run.moveFrac / 2), 12000, 1e-6));
});

test("set length: passes, ovals end on an even pass, and timers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eyepath-test-"));
  try {
    const session = new Session(dir);
    const set = (p) => { session.params = { ...DEFAULT_PARAMS, ...p }; return makeRun(session.params); };

    let run = set({ setMode: "passes", passes: 24 });
    assert.equal(session.targetFor(run, run.moveFrac / 2, 0), 24);

    run = set({ setMode: "passes", passes: 5, pattern: "oval" });
    assert.equal(session.targetFor(run, run.moveFrac / 2, 0), 6);

    run = set({ setMode: "timer", seconds: 5, speed: 1 });
    assert.equal(session.targetFor(run, run.moveFrac / 2, 0), 5);

    run = set({ setMode: "open" });
    assert.equal(session.targetFor(run, run.moveFrac / 2, 0), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("changing speed, pause or movement during a set doesn't move the light", () => {
  const cases = [
    [{ speed: 2, pause: 80, easing: "sine" }, { speed: 3.5, pause: 0, easing: "sine" }],
    [{ speed: 1, pause: 200, easing: "sine" }, { speed: 1, pause: 0, easing: "linear" }],
    [{ speed: 2.4, pause: 50, easing: "linear" }, { speed: 0.6, pause: 300, easing: "sine" }],
    [{ speed: 2, pause: 80, easing: "jump" }, { speed: 4, pause: 0, easing: "jump" }],
  ];
  for (const pattern of ["horizontal", "diagUp", "figure8", "ovalr"]) {
    for (const [from, to] of cases) {
      for (const target of [null, 12]) {
        const run = makeRun({ ...DEFAULT_PARAMS, ...from, pattern }, { target });
        const next = timing({ ...DEFAULT_PARAMS, ...to });
        for (let phi = 0.05; phi < 12.5; phi += 0.37) {
          const before = position(run, phi);
          const newPhi = remapPhase(run, phi, next.moveFrac, to.easing);
          const after = position({ ...run, moveFrac: next.moveFrac, easing: to.easing }, newPhi);
          assert.ok(close(before[0], after[0], 1e-9) && close(before[1], after[1], 1e-9),
            `${pattern} ${JSON.stringify(from)} -> ${JSON.stringify(to)} target ${target} at phase ${phi.toFixed(2)}`);
        }
      }
    }
  }
});

test("the server and the screens use the same motion maths", () => {
  for (const name of ["sine", "linear", "jump"]) {
    for (let u = 0; u <= 1.0001; u += 0.05) {
      assert.ok(close(ease(name, u), Motion.ease[name](u)), `${name} at ${u}`);
    }
  }
  const run = makeRun({ ...DEFAULT_PARAMS, speed: 2.7, pause: 120 });
  run.anchorT = 1500; run.anchorPhase = 3.25;
  for (const t of [0, 1500, 2000, 9876.5]) assert.ok(close(phaseAt(run, t), Motion.phaseAt(run, t)), `phase at ${t}`);
  for (const phi of [3.25, 4, 10.5]) assert.ok(close(timeAtPhase(run, phi), Motion.timeAtPhase(run, phi)), `time at ${phi}`);
  assert.equal(END_FADE_MS, Motion.END_FADE);
  assert.equal(STOP_NOW_MS, Motion.STOP_NOW);
});

test("settings are cleaned: limits, whole numbers, choices, colours and odd names", () => {
  const current = { ...DEFAULT_PARAMS };
  assert.deepEqual(cleanParams({ speed: 10 }, current), { speed: 4 });
  assert.deepEqual(cleanParams({ pitch: 1500 }, current), { pitch: 1200 });
  assert.deepEqual(cleanParams({ passes: 7.6 }, current), { passes: 8 });
  assert.deepEqual(cleanParams({ color: "#ABCDEF" }, current), { color: "#abcdef" });
  assert.deepEqual(cleanParams({ color: "red", pattern: "spiral", speed: "fast" }, current), {});
  assert.deepEqual(cleanParams({ speed: current.speed }, current), {});                       // unchanged
  assert.deepEqual(cleanParams(JSON.parse('{"__proto__": 1, "constructor": 1, "toString": 1}'), current), {});
});

test("dual attention: every screen gets the same sequence, within the level's timing", () => {
  const run = { status: "running", setStartT: 0, target: null, anchorT: 0, anchorPhase: 0.5, rate: 2, moveFrac: 1,
                dual: { task: "numbers", level: "medium", seed: 12345 } };
  const shown = [...Dual.shown(run, 60000).values];
  const other = [...loadScreenCode().Dual.shown(run, 60000).values];   // a second screen
  assert.deepEqual(shown, other);
  assert.ok(shown.length >= 10, `${shown.length} numbers in a minute`);
  assert.ok(shown.every((v, i) => /^[1-9]$/.test(v) && v !== shown[i - 1]), "single digits, never the same twice in a row");

  // Medium: each number shows for 750 ms, then a gap of 2-4 s before the next.
  const starts = [];
  let on = false;
  for (let t = 0; t <= 60000; t += 10) {
    const now = Dual.at(run, t) !== null;
    if (now && !on) starts.push(t);
    on = now;
  }
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= 750 + 2000 - 10 && gap <= 750 + 4000 + 10, `gap ${gap} ms`);
  }
});
