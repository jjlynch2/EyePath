// Shared by the client screen and the therapist remote: clock sync, the live
// state stream, the motion maths and the drawing of the ball.
"use strict";

// ------------------------------------------------------------------ clock
// Server time = performance.now() + offset. The offset comes from the
// fastest of several round trips, and small later corrections are slewed in
// a little at a time so the ball never jumps.
//
// A phone that sleeps (screen locked between sets) pauses performance.now(),
// so afterwards the offset is out by however long it slept. That shows up as
// a jump between performance.now() and the wall clock: the old measurements
// are then thrown away and the clock is measured again straight away.
const Clock = {
  offset: 0,
  target: 0,
  ready: false,
  samples: [],
  wallGap: null,            // Date.now() - performance.now(), to notice sleep

  now() { return this.serverTime(performance.now()); },
  serverTime(perfMs) { return perfMs + this.offset; },

  async sample() {
    const t0 = performance.now();
    const res = await fetch("/api/time", { cache: "no-store" });
    const { t } = await res.json();
    const t1 = performance.now();
    const wall = Date.now();   // ages samples in real time, which keeps running during sleep
    this.samples.push({ rtt: t1 - t0, offset: t - (t0 + t1) / 2, wall });
    this.samples = this.samples.filter((s) => wall - s.wall < 5 * 60 * 1000).slice(-30);
  },

  // True (and the old measurements dropped) if the device slept since last time.
  checkSleep() {
    const gap = Date.now() - performance.now();
    const slept = this.wallGap !== null && Math.abs(gap - this.wallGap) > 1000;
    this.wallGap = gap;
    if (slept) this.samples = [];
    return slept;
  },

  async sync(count) {
    this.checkSleep();
    for (let i = 0; i < count; i++) {
      try { await this.sample(); } catch (e) { /* offline; try again later */ }
    }
    if (!this.samples.length) return;
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.target = best.offset;
    // First time, or far out (after sleep): go straight there. Small corrections are slewed.
    if (!this.ready || Math.abs(this.target - this.offset) > 100) this.offset = this.target;
    this.ready = true;
  },

  // Called once per frame: move at most 0.5 ms toward the measured offset.
  slew() {
    const d = this.target - this.offset;
    this.offset += Math.max(-0.5, Math.min(0.5, d));
  },

  start() {
    const first = this.sync(8);
    setInterval(() => this.sync(3), 20000);
    setInterval(() => { if (this.checkSleep()) this.sync(5); }, 2000);
    // Measure again when the screen comes back on or the tab is shown again.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.sync(5); });
    return first;
  },
};

// ------------------------------------------------------------------ state stream
function connectState(role, onState, onStatus, pageId = "") {
  let es;
  const open = () => {
    es = new EventSource(`/api/events?role=${role}${pageId ? `&id=${pageId}` : ""}`);
    es.onopen = () => onStatus(true);
    es.onmessage = (ev) => onState(JSON.parse(ev.data));
    es.onerror = async () => {
      onStatus(false);
      // A lapsed login shows up as an error; send the user to the login page.
      try {
        const r = await fetch("/api/info", { cache: "no-store" });
        if (r.status === 401) location.href = `/login?next=/${role}`;
      } catch (e) { /* server down; EventSource keeps retrying */ }
    };
  };
  open();
}

async function sendCommand(cmd) {
  const res = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (res.status === 401) location.href = `/login?next=${location.pathname}`;
  return res.ok;
}

// ------------------------------------------------------------------ motion
// Mirrors the maths in server.js. Phase counts periods; one period is one
// sweep plus the edge pause. Touch k (reaching an edge) is at phase
// k + moveFrac. A set starts mid-sweep (the resting point) and, with a target
// of N touches, glides back to the resting point during [N, N + moveFrac/2].
const Motion = (() => {
  const ease = {
    sine: (u) => (1 - Math.cos(Math.PI * u)) / 2,
    linear: (u) => u,
    jump: (u) => (u >= 1 ? 1 : 0),   // waits, then snaps across exactly when it "reaches" the side
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const START_FADE = 400, END_FADE = 700, STOP_NOW = 350;

  function phaseAt(run, t) {
    return t <= run.anchorT ? run.anchorPhase : run.anchorPhase + ((t - run.anchorT) / 1000) * run.rate;
  }
  function timeAtPhase(run, phi) {
    return run.anchorT + ((phi - run.anchorPhase) / run.rate) * 1000;
  }

  // Which sweep we are on (k) and how far along it (p, 0..1, eased).
  function sweepAt(run, phi) {
    const mf = run.moveFrac, e = ease[run.easing] || ease.sine, N = run.target;
    if (N != null && phi >= N) {
      const u = clamp01((phi - N) / (mf / 2));
      return { k: N, p: 0.5 * e(u), touches: N, settled: u >= 1 };
    }
    if (phi < mf) {
      return { k: 0, p: 0.5 + 0.5 * e(clamp01((phi - mf / 2) / (mf / 2))), touches: 0, settled: false };
    }
    const k = Math.floor(phi), f = phi - k;
    const touches = Math.floor(phi - mf) + 1;
    return { k, p: f < mf ? e(f / mf) : 1, touches: N == null ? touches : Math.min(touches, N), settled: false };
  }

  // Map sweep k, progress p onto a track. X and Y are in -1..1; b is the
  // left/right value used for sound panning (always ±1 at a touch).
  // The "r" tracks are mirror images: same resting point, opposite direction.
  function point(pattern, k, p) {
    if (pattern === "figure8" || pattern === "oval" || pattern === "figure8r" || pattern === "ovalr") {
      const a = (k + p) * Math.PI - Math.PI / 2;
      const b = pattern.endsWith("r") ? -Math.sin(a) : Math.sin(a);
      return pattern.startsWith("oval") ? { X: b, Y: -Math.cos(a), b } : { X: b, Y: Math.sin(2 * a), b };
    }
    const s = k % 2 === 0 ? -1 + 2 * p : 1 - 2 * p;
    switch (pattern) {
      case "vertical": return { X: 0, Y: s, b: s };
      case "diagUp": return { X: s, Y: -s, b: s };
      case "diagDown": return { X: s, Y: s, b: s };
      default: return { X: s, Y: 0, b: s };
    }
  }
  const restPoint = (pattern) => point(pattern, 0, 0.5);
  // Which side touch k is on: 1 = right, -1 = left.
  const touchSide = (pattern, k) => Math.sign(point(pattern, k, 1).b) || 1;

  // Everything a screen needs to draw one frame at server time t.
  function frame(state, t) {
    const { params, run } = state;
    const rest = params.rest;
    if (run.status === "running") {
      const phi = phaseAt(run, t);
      const sw = sweepAt(run, phi);
      const pt = point(run.pattern, sw.k, sw.p);
      let opacity = 1;
      if (!rest) {
        opacity = clamp01((t - run.setStartT) / START_FADE);   // setStartT, not anchorT: speed changes move anchorT
        if (sw.settled && run.endT) opacity *= 1 - clamp01((t - run.endT) / END_FADE);
      }
      return { ...pt, opacity, running: !sw.settled, touches: sw.touches, target: run.target,
               ending: run.target != null && phi >= run.target, phase: phi, dual: Dual.at(run, t) };
    }
    if (run.status === "stopping") {
      const from = frame({ params, run: run.prev }, run.stopT);
      const home = restPoint(run.prev.pattern);
      const u = clamp01((t - run.stopT) / STOP_NOW), e = ease.sine(u);
      const mix = (a, b) => a + (b - a) * e;
      return { X: mix(from.X, home.X), Y: mix(from.Y, home.Y), b: mix(from.b, home.b),
               opacity: rest ? 1 : from.opacity * (1 - u), running: false,
               touches: from.touches, target: from.target, ending: true };
    }
    return { ...restPoint(params.pattern), opacity: rest ? 1 : 0, running: false, touches: 0, target: null, ending: false };
  }

  return { ease, clamp01, phaseAt, timeAtPhase, sweepAt, point, touchSide, frame };
})();

// ------------------------------------------------------------------ dual attention
// Optional things for the client to watch for while following the light:
// colour flashes, numbers or letters. A set's sequence comes from its seed, so
// the client screen, the remote's preview and its answer list always agree.
const Dual = (() => {
  // [shortest gap, longest gap, time shown] in ms
  const LEVELS = { easy: [4000, 7000, 900], medium: [2000, 4000, 750], hard: [600, 1200, 550] };
  const LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";          // no I, O, Q (look like 1, 0)
  const FLASH_COLORS = ["#ffd23f", "#ff4d6d", "#3ddc84", "#ffffff", "#b388ff", "#4da3ff"];
  const sequences = new Map();

  // Small seeded random number generator (mulberry32).
  function seeded(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // The set's events (ms after it starts), generated up to `upto`.
  function events(dual, upto) {
    const key = `${dual.seed}|${dual.task}|${dual.level}`;
    const [lo, hi, show] = LEVELS[dual.level] || LEVELS.medium;
    let s = sequences.get(key);
    if (!s) {
      const random = seeded(dual.seed);
      s = { random, list: [], nextAt: 1200 + random() * (hi - lo) };
      sequences.set(key, s);
    }
    while (s.nextAt <= upto) {
      const r = s.random, prev = s.list.length ? s.list[s.list.length - 1].value : null;
      let value = "flash";
      if (dual.task === "numbers") do { value = String(1 + Math.floor(r() * 9)); } while (value === prev);
      if (dual.task === "letters") do { value = LETTERS[Math.floor(r() * LETTERS.length)]; } while (value === prev);
      const len = dual.task === "flash" ? Math.min(show, 450) : show;
      s.list.push({ at: s.nextAt, until: s.nextAt + len, value });
      s.nextAt += len + lo + r() * (hi - lo);
    }
    return s.list;
  }

  // Nothing new appears once the light starts gliding home.
  const cutoff = (run) => (run.target != null ? Motion.timeAtPhase(run, run.target) : Infinity);

  // What to show at server time t, or null.
  function at(run, t) {
    if (!run || !run.dual || run.status !== "running") return null;
    const off = t - run.setStartT;
    if (off < 0 || t >= cutoff(run)) return null;
    const list = events(run.dual, off);
    const e = list[list.length - 1];      // gaps are longer than display times, so only the latest can be showing
    return e && off < e.until ? { task: run.dual.task, value: e.value } : null;
  }

  // Everything shown so far in this set: the answers for the therapist.
  function shown(run, t) {
    const r = run.status === "stopping" ? run.prev : run;
    if (!r || !r.dual) return null;
    const end = Math.min(run.status === "stopping" ? run.stopT : t, cutoff(r)) - r.setStartT;
    if (end < 0) return { task: r.dual.task, values: [] };
    return { task: r.dual.task, values: events(r.dual, end).filter((e) => e.at <= end).map((e) => e.value) };
  }

  // A flash colour that stands out against the light's own colour.
  function flashColor(base) {
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const b = rgb(base);
    let best = FLASH_COLORS[0], bestD = -1;
    for (const c of FLASH_COLORS) {
      const d = rgb(c).reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
      if (d > bestD) { bestD = d; best = c; }
    }
    return best;
  }

  return { at, shown, flashColor };
})();

// ------------------------------------------------------------------ drawing
// The ball is one element moved with a GPU transform; the faint track is
// drawn once onto a canvas behind it and redrawn only on resize or change.
// Shapes for the light, drawn in a 100 x 100 box. The circle is plain CSS.
const SHAPES = (() => {
  const star = Array.from({ length: 10 }, (_, i) => {
    const a = ((-90 + i * 36) * Math.PI) / 180, r = i % 2 ? 20 : 49;
    return `${(50 + r * Math.cos(a)).toFixed(1)},${(54 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return {
    star: `<polygon points="${star}"/>`,
    heart: `<path d="M50 90C22 70 4 52 4 32 4 17 15 7 28 7c9 0 17 5 22 13C55 12 63 7 72 7c13 0 24 10 24 25 0 20-18 38-46 58z"/>`,
    diamond: `<polygon points="50,2 96,50 50,98 4,50"/>`,
    square: `<rect x="8" y="8" width="84" height="84" rx="12"/>`,
  };
})();

// Child-friendly shapes: Google Noto Emoji images (static/emoji, Apache 2.0).
// The value is the way the picture faces, so it can turn to face where it's going.
const EMOJI = {
  dog: null, cat: null, butterfly: null, fish: "left", turtle: "left",
  unicorn: "left", rocket: "right", goldstar: null, rainbow: null, ball: null,
};

class Stage {
  constructor(el) {
    this.el = el;
    el.classList.add("stage");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "track";
    this.ball = document.createElement("div");
    this.ball.className = "ball";
    // Numbers and letters sit in their own layer, so they never flip with a turning animal.
    this.label = document.createElement("div");
    this.label.className = "ball-label";
    el.append(this.canvas, this.ball, this.label);
    this.params = null;
    this.trackKey = "";
    this.lastOpacity = -1;
    this.measure();
    new ResizeObserver(() => { this.measure(); this.apply(this.params, true); }).observe(el);
  }

  measure() {
    // Inside the border, where the canvas and ball are positioned.
    this.w = this.el.clientWidth; this.h = this.el.clientHeight;
  }

  geometry(p) {
    const d = Math.max(4, (p.size / 100) * this.h);
    const room = Math.max(0, this.h - d) / 2;          // furthest the ball's centre can go from the middle
    const rx = (p.travel / 100) * Math.max(0, this.w - d) / 2;
    // Height moves the track up (+) or down (-); taller tracks shrink so they stay on screen.
    const dy = Math.max(-room, Math.min(room, -((p.height || 0) / 100) * this.h));
    const ry = Math.min((p.travel / 100) * room, room - Math.abs(dy));
    return { d, rx, ry, dy };
  }

  // Track coordinates (-1..1) to pixels from the centre.
  toPx(pattern, X, Y) {
    const { rx, ry, dy } = this.g;
    if (pattern.startsWith("figure8")) return [X * rx, Y * Math.min(ry, rx * 0.45) + dy];
    return [X * rx, Y * ry + dy];
  }

  apply(p, force = false) {
    if (!p) return;
    const prev = this.params;
    this.params = p;
    this.g = this.geometry(p);
    const changed = (k) => force || !prev || prev[k] !== p[k];
    if (changed("background")) this.el.style.background = p.background;
    if (changed("size") || changed("color") || changed("glow") || changed("shape")) {
      const { d } = this.g;
      for (const s of [this.ball.style, this.label.style]) {
        s.width = s.height = `${d}px`;
        s.marginLeft = s.marginTop = `${-d / 2}px`;
      }
      this.label.style.fontSize = `${Math.max(10, d * 0.58)}px`;
      this.label.classList.toggle("on-picture", p.shape in EMOJI);
      this.renderLight(this.flashing ? Dual.flashColor(p.color) : null);
    }
  }

  // Paint the light in its colour, or in `flash` while a colour flash shows.
  renderLight(flash) {
    const p = this.params, { d } = this.g, s = this.ball.style;
    const c = flash || p.color;
    const shape = SHAPES[p.shape];
    if (p.shape in EMOJI) {                            // emoji keep their own colours; the glow uses the colour
      s.borderRadius = "0";
      s.background = "none";
      s.boxShadow = "none";
      const glow = p.glow ? `drop-shadow(0 0 ${d * 0.12}px ${c}) drop-shadow(0 0 ${d * 0.3}px ${c})` : "";
      const tint = flash ? "hue-rotate(160deg) saturate(1.8) brightness(1.1) " : "";
      s.filter = (tint + glow).trim() || "none";
      if (this.picture !== p.shape) {                 // don't reload the picture for a flash
        this.picture = p.shape;
        this.ball.innerHTML = `<img src="/static/emoji/${p.shape}.svg" alt="" draggable="false" style="width:100%;height:100%;display:block">`;
      }
      return;
    }
    this.picture = null;
    if (!shape) {                                      // circle
      this.ball.replaceChildren();
      s.borderRadius = "50%";
      s.background = `radial-gradient(circle at 50% 45%, #fff 0%, ${c} 38%, ${c} 100%)`;
      s.boxShadow = p.glow ? `0 0 ${d * 0.6}px ${d * 0.18}px ${c}` : "none";
      s.filter = "none";
    } else {
      s.borderRadius = "0";
      s.background = "none";
      s.boxShadow = "none";
      s.filter = p.glow ? `drop-shadow(0 0 ${d * 0.15}px ${c}) drop-shadow(0 0 ${d * 0.35}px ${c})` : "none";
      this.ball.innerHTML =
        `<svg viewBox="0 0 100 100" width="100%" height="100%" style="display:block">` +
        `<defs><radialGradient id="lightFill" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#fff"/>` +
        `<stop offset="0.38" stop-color="${c}"/><stop offset="1" stop-color="${c}"/></radialGradient></defs>` +
        `<g fill="url(#lightFill)">${shape}</g></svg>`;
    }
  }

  drawTrack(pattern, show) {
    const p = this.params;
    const key = [pattern, show, p.color, p.size, p.travel, p.height, this.w, this.h].join("|");
    if (key === this.trackKey) return;
    this.trackKey = key;
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (!show) return;
    // The offset is in canvas pixels, so it is scaled by the pixel density too.
    ctx.setTransform(dpr, 0, 0, dpr, (this.w / 2) * dpr, (this.h / 2) * dpr);
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(2, this.g.d * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const q = (i / steps) * 2;                       // two sweeps close every loop
      const pt = Motion.point(pattern, Math.floor(q), q - Math.floor(q));
      const [x, y] = this.toPx(pattern, pt.X, pt.Y);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  draw(state, fr) {
    const p = state.params;
    if (p !== this.params) this.apply(p);
    const pattern = state.run.status === "running" ? state.run.pattern
      : state.run.status === "stopping" ? state.run.prev.pattern : p.pattern;
    this.drawTrack(pattern, p.track);
    const [x, y] = this.toPx(pattern, fr.X, fr.Y);
    // Pictures with a facing direction turn to face the way they're moving.
    const faces = EMOJI[p.shape];
    if (faces && this.lastX !== undefined && Math.abs(x - this.lastX) > 0.2) this.heading = x > this.lastX ? "right" : "left";
    this.lastX = x;
    const flip = faces && this.heading && this.heading !== faces ? " scaleX(-1)" : "";
    const move = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    this.ball.style.transform = move + flip;
    const o = p.visual ? Math.round(fr.opacity * 1000) / 1000 : 0;
    if (o !== this.lastOpacity) { this.ball.style.opacity = o; this.lastOpacity = o; }

    // Dual attention: a colour flash, or a number/letter on the light.
    const dual = fr.dual;
    const flashing = !!dual && dual.task === "flash";
    if (flashing !== !!this.flashing) {
      this.flashing = flashing;
      this.renderLight(flashing ? Dual.flashColor(p.color) : null);
    }
    const text = dual && dual.task !== "flash" ? dual.value : "";
    if (text !== this.labelText) { this.labelText = text; this.label.textContent = text; }
    const lo = text ? o : 0;
    if (lo !== this.labelOpacity) { this.label.style.opacity = lo; this.labelOpacity = lo; }
    if (text) this.label.style.transform = move;
  }
}
