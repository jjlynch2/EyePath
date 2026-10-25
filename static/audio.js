// Bilateral sound for the client screen.
// Clicks and tones are scheduled ahead on the audio clock at the exact moment
// the ball reaches each side, so timing does not depend on frame rate. The
// "sweep" sound is a steady tone panned continuously with the ball.
"use strict";

class BilateralAudio {
  constructor() {
    this.ctx = null;
    this.runId = null;
    this.nextTouch = 0;
    this.pending = [];        // scheduled sounds not yet played: { k, at, nodes }
    this.lastRamp = 0;
  }

  // Must be called from a click or tap (browsers block audio until then).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      // Left/right balance: a volume control for each ear, after every other sound.
      const split = this.ctx.createChannelSplitter(2), merge = this.ctx.createChannelMerger(2);
      this.leftEar = this.ctx.createGain();
      this.rightEar = this.ctx.createGain();
      this.master.connect(split);
      split.connect(this.leftEar, 0);
      split.connect(this.rightEar, 1);
      this.leftEar.connect(merge, 0, 0);
      this.rightEar.connect(merge, 0, 1);
      merge.connect(this.ctx.destination);
      // Sweep voice: always running, silent until a sweep set plays.
      this.sweepOsc = this.ctx.createOscillator();
      this.sweepGain = this.ctx.createGain();
      this.sweepPan = this.ctx.createStereoPanner();
      this.sweepGain.gain.value = 0;
      this.sweepOsc.type = "sine";
      this.sweepOsc.connect(this.sweepGain).connect(this.sweepPan).connect(this.master);
      this.sweepOsc.start();
    }
    return this.ctx.resume();
  }

  get ready() { return this.ctx && this.ctx.state === "running"; }

  // Server time (ms) -> audio context time (s), including the user's offset.
  audioTime(serverMs, offsetMs) {
    const ctx = this.ctx;
    const perfMs = serverMs - Clock.offset + offsetMs;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    const latency = ctx.outputLatency || ctx.baseLatency || 0;
    return ctx.currentTime + (perfMs - performance.now()) / 1000 - latency;
  }

  // Touch k of the current set, reached at server time t, sounding at audio time at.
  playTouch(k, at, params, pattern, t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Motion.touchSide(pattern, k);   // the side the ball is on
    osc.frequency.value = params.pitch;
    const peak = params.volume;
    const g = gain.gain;
    let end;
    if (params.sound === "click") {
      osc.type = "triangle";
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(peak, at + 0.002);
      g.exponentialRampToValueAtTime(0.0001, at + 0.05);
      end = at + 0.06;
    } else {
      osc.type = "sine";
      const len = Math.min(0.16, 0.45 / params.speed);
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(peak * 0.8, at + 0.015);
      g.setValueAtTime(peak * 0.8, at + len - 0.04);
      g.linearRampToValueAtTime(0, at + len);
      end = at + len + 0.01;
    }
    osc.connect(gain).connect(pan).connect(this.master);
    osc.start(at);
    osc.stop(end);
    const entry = { run: this.runId, k, t, at, osc };
    this.pending.push(entry);
    osc.onended = () => { this.pending = this.pending.filter((e) => e !== entry); };
  }

  // Sound check: a tone in the left ear, then the right, with the current pitch,
  // volume, balance and sound delay.
  playCheck(serverMs, params) {
    const toneLen = 0.45, gap = 0.75;
    [-1, 1].forEach((side, i) => {
      const at = this.audioTime(serverMs, params.audioOffset) + i * gap;
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
      pan.pan.value = side;
      osc.type = "sine";
      osc.frequency.value = params.pitch;
      const g = gain.gain, peak = params.volume * 0.8;
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(peak, at + 0.02);
      g.setValueAtTime(peak, at + toneLen - 0.06);
      g.linearRampToValueAtTime(0, at + toneLen);
      osc.connect(gain).connect(pan).connect(this.master);
      osc.start(at);
      osc.stop(at + toneLen + 0.02);
    });
    return { toneLen, gap };
  }

  // Stop queued sounds that haven't started yet and match `which`.
  cancelWhere(which) {
    const now = this.ctx.currentTime;
    for (const e of this.pending) {
      if (e.at > now && which(e)) { try { e.osc.stop(); } catch (err) { /* already stopped */ } }
    }
  }

  // The current set's touches from k on.
  cancelFrom(k) { this.cancelWhere((e) => e.run === this.runId && e.k >= k); }

  // Call often (every frame and from a timer). Schedules what is coming up.
  // silent: play nothing (the code screen is showing or the app is unreachable).
  update(state, silent = false) {
    if (!this.ready) return;
    const { params, run } = state;
    const now = Clock.now();
    const offset = params.audioOffset;
    // Pitch and balance: only when they change (this runs dozens of times a second).
    if (params.pitch !== this.appliedPitch) {
      this.appliedPitch = params.pitch;
      this.sweepOsc.frequency.setTargetAtTime(params.pitch, this.ctx.currentTime, 0.05);
    }
    const bal = (params.balance || 0) / 100;
    if (bal !== this.appliedBalance) {
      this.appliedBalance = bal;
      this.leftEar.gain.setTargetAtTime(bal > 0 ? 1 - bal : 1, this.ctx.currentTime, 0.05);
      this.rightEar.gain.setTargetAtTime(bal < 0 ? 1 + bal : 1, this.ctx.currentTime, 0.05);
    }

    const touchSounds = params.sound === "click" || params.sound === "tone";
    if (run.status !== "running" || silent) {
      if (silent) {
        this.cancelWhere(() => true);                    // code screen or app unreachable: nothing plays
      } else if (this.runId) {
        // The set ended. Touches that happened keep their sound (with a sound delay it can
        // still be waiting to play); touches that now never happen (after Stop now) don't.
        const cutoff = run.status === "stopping" ? run.stopT : now;
        this.cancelWhere((e) => e.t > cutoff);
      }
      this.runId = null;
    } else {
      // When speed, pause or movement change mid-set, touches still to come move
      // in time, so sounds already queued for them are cancelled and queued again.
      const timing = `${run.anchorT}|${run.anchorPhase}|${run.rate}|${run.moveFrac}|${run.easing}`;
      if (run.id !== this.runId || timing !== this.timing) {
        const sameSet = run.id === this.runId;
        if (!sameSet && this.runId) {                     // a new set straight after another
          const old = this.runId;
          this.cancelWhere((e) => e.run === old && e.t > now);
        }
        this.runId = run.id;
        this.timing = timing;
        // Next touch from now; touches already past keep their sound (it may still be
        // waiting to play, with a sound delay set).
        const phi = Motion.phaseAt(run, now);
        this.nextTouch = phi < run.moveFrac ? 0 : Math.floor(phi - run.moveFrac) + 1;
        // A sound already playing (possible with a negative sound delay) isn't queued twice.
        if (sameSet) {
          for (const e of this.pending) {
            if (e.run === this.runId && e.at <= this.ctx.currentTime) this.nextTouch = Math.max(this.nextTouch, e.k + 1);
          }
        }
        this.cancelFrom(this.nextTouch);
      }
      const last = run.target == null ? Infinity : run.target;   // touches 0..target-1
      this.cancelFrom(last);
      // Queue 200 ms ahead, plus enough for a negative sound delay (sound earlier than the light).
      const horizon = now + 200 + Math.max(0, -offset);
      while (this.nextTouch < last) {
        const t = Motion.timeAtPhase(run, this.nextTouch + run.moveFrac);
        if (t > horizon) break;
        if (touchSounds && t >= now - 15) this.playTouch(this.nextTouch, this.audioTime(t, offset), params, run.pattern, t);
        this.nextTouch++;
      }
      if (!touchSounds) this.cancelFrom(0);
    }

    // Sweep voice: ramp pan and loudness toward where the ball will be shortly.
    const ahead = now + 60;
    const fr = Motion.frame(state, ahead);
    let level = 0;
    if (params.sound === "sweep" && run.status === "running" && !silent) {
      const startEnv = Motion.clamp01((ahead - run.setStartT) / 150);   // not anchorT, which speed changes move
      const endEnv = run.endT ? Motion.clamp01((run.endT - ahead) / 150) : 1;
      level = params.volume * 0.6 * startEnv * endEnv;
    }
    const at = Math.max(this.audioTime(ahead, offset), this.ctx.currentTime);
    if (this.lastRamp - at > 0.25) {
      // The time mapping jumped back (e.g. the sound delay was lowered); start the ramps afresh.
      this.sweepPan.pan.cancelScheduledValues(this.ctx.currentTime);
      this.sweepGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.lastRamp = 0;
    }
    if (at > this.lastRamp) {
      this.sweepPan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, fr.b)), at);
      this.sweepGain.gain.linearRampToValueAtTime(level, at);
      this.lastRamp = at;
    }
  }
}
