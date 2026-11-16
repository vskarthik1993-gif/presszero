// PressZero Expression Model — the performer.
//
// Runs every frame. Mixes four layers into one face pose:
//   speech   — mouth shapes read from the lip-sync timeline at the audio clock
//   emotion  — a slow-moving emotional state (from affect.js or direct cues)
//   life     — blinks, saccades, breathing, postural sway: what a face does
//              even when nothing is happening
//   rhythm   — nods and brow beats locked to vocal emphasis, listener nods
// Each layer is cheap arithmetic; there is no model inference per frame.

import { EMOTIONS } from './affect.js';

const rand = (a, b) => a + Math.random() * (b - a);
const ease = (x, target, dt, tau) => x + (target - x) * (1 - Math.exp(-dt / tau));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

class Spring {
  constructor(freq, damping = 1) { this.x = 0; this.v = 0; this.w = freq * 2 * Math.PI; this.z = damping; }
  step(target, dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.008)); const h = dt / steps;
    for (let i = 0; i < steps; i += 1) { const a = this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v; this.v += a * h; this.x += this.v * h; }
    return this.x;
  }
  kick(v) { this.v += v; }
}

// How each emotion sits on the face. Mouth terms are reduced while speaking so
// articulation stays readable through the expression.
const LOOKS = {
  joy: { smile: 0.8, squint: 0.55, browUp: 0.14, upperUp: 0.3, mouthOpen: 0.05 },
  sad: { browIn: 0.85, frown: 0.4, squint: 0.1, roll: 0.035, pitch: 0.03 },
  surprise: { browUp: 0.95, eyeWide: 0.9, mouthOpen: 0.16 },
  concern: { browIn: 0.5, browDown: 0.3, squint: 0.22, press: 0.2, pitch: 0.02 },
  think: { browDown: 0.2, browUpL: 0.4, press: 0.45, gazeX: 0.55, gazeY: -0.5, roll: -0.03, yaw: 0.04 },
};

export class Performer {
  constructor(lipsync, { clock } = {}) {
    this.lip = lipsync; this.clock = clock || (() => performance.now() / 1000);
    this.mode = 'idle';                 // idle | listening | thinking | speaking
    this.intensity = 1;                 // overall expressiveness
    this.emotion = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
    this.target = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
    this.hold = Object.fromEntries(EMOTIONS.map((e) => [e, 0]));
    this.warmth = 0.2;                  // resting pleasantness
    this.mouth = { jaw: new Spring(7.5, 0.82), wide: new Spring(6.5, 0.9), round: new Spring(6.5, 0.9), teeth: new Spring(9, 1), press: new Spring(8, 1) };
    this.head = { yaw: new Spring(1.1, 0.9), pitch: new Spring(1.5, 0.75), roll: new Spring(1.0, 0.9), x: new Spring(0.9, 1), y: new Spring(1.2, 0.9) };
    this.gaze = { x: new Spring(11, 0.85), y: new Spring(11, 0.85), tx: 0, ty: 0, next: 0.6, away: false };
    this.brow = new Spring(3.4, 0.6); this.browL = new Spring(3.2, 0.7);
    this.blink = { next: rand(1, 3), t: -1, dur: 0.24, queue: 0, value: 0, wink: 0 };
    this.poseShift = { yaw: 0, pitch: 0, roll: 0, x: 0 };
    this.env = { fast: 0, slow: 0, speaking: false, silence: 1, lastBeat: 0, sinceStart: 0 };
    this.listen = { level: 0, talking: false, since: 0, nodAt: 0 };
    this.gest = { laugh: 0, gasp: 0, sigh: 0, shake: 0, ask: 0 };
    this.time = 0; this.sample = {};
    this.phase = [rand(0, 9), rand(0, 9), rand(0, 9), rand(0, 9)];
    this.override = null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'thinking') { this.feel('think', 0.75, { hold: 1.2 }); }
    if (this.mode === 'thinking' && mode === 'speaking') { this.target.think = 0; this.hold.think = 0; this.queueBlink(); }
    if (mode === 'listening') { this.gaze.away = false; this.gaze.tx = 0; this.gaze.ty = 0; }
    this.mode = mode;
  }

  feel(emotion, amount = 0.8, { hold = 1.6 } = {}) {
    if (!(emotion in this.target)) return;
    // Opposites displace each other rather than stacking.
    const rivals = { joy: ['sad', 'concern'], sad: ['joy'], concern: ['joy'], surprise: [], think: [] }[emotion];
    for (const rival of rivals) { this.target[rival] *= 0.3; this.hold[rival] = 0; }
    this.target[emotion] = Math.max(this.target[emotion], clamp01(amount));
    this.hold[emotion] = Math.max(this.hold[emotion], hold);
    if (emotion === 'surprise') this.queueBlink(0.25);
  }

  calm() { for (const e of EMOTIONS) { this.target[e] = 0; this.hold[e] = 0; } }

  queueBlink(delay = 0) { this.blink.next = Math.min(this.blink.next, delay); }

  gesture(name) {
    const h = this.head;
    if (name === 'nod') { h.pitch.kick(0.55); this.nodAgain = this.time + 0.36; }
    else if (name === 'emphasis') { h.pitch.kick(0.32); this.brow.kick(2.2); }
    else if (name === 'ask') { this.gest.ask = 1; this.brow.kick(2.6); h.pitch.kick(-0.18); }
    else if (name === 'shake') this.gest.shake = 1;
    else if (name === 'laugh') { this.gest.laugh = 1; this.feel('joy', 1, { hold: 1.8 }); }
    else if (name === 'gasp') { this.gest.gasp = 1; this.feel('surprise', 1, { hold: 1.1 }); h.pitch.kick(-0.3); }
    else if (name === 'sigh') { this.gest.sigh = 1; h.pitch.kick(0.2); }
    else if (name === 'wink') this.blink.wink = 0.001;
    else if (name === 'blink') this.queueBlink();
  }

  // Microphone level 0..1 while the user is talking: drives listener behaviour.
  hear(level) { this.listen.level = Math.max(level, this.listen.level * 0.9); }

  update(dt, audioTime) {
    dt = Math.min(0.1, Math.max(0.001, dt)); this.time += dt; const t = this.time; const I = this.intensity;
    const s = this.lip.sample(audioTime, this.sample);
    const voiced = this.lip.active(audioTime);
    const shapes = {}; const add = (k, v) => { if (v) shapes[k] = (shapes[k] || 0) + v; };
    const both = (k, v) => { add(`${k}R`, v); add(`${k}L`, v); };

    // ---- speech envelope, phrasing and beats ----
    const env = this.env;
    env.fast = ease(env.fast, s.energy, dt, 0.045); env.slow = ease(env.slow, s.energy, dt, 0.42);
    if (s.energy > 0.12) {
      if (!env.speaking && env.silence > 0.28) this.phraseStart(env.silence);
      env.speaking = true; env.silence = 0; env.sinceStart += dt;
    } else { env.silence += dt; if (env.silence > 0.2 && env.speaking) { env.speaking = false; env.sinceStart = 0; if (Math.random() < 0.45) this.queueBlink(rand(0.05, 0.25)); } }
    if (env.speaking && env.fast - env.slow > 0.24 && t - env.lastBeat > 0.42) {
      env.lastBeat = t; const strength = Math.min(1, (env.fast - env.slow) * 2.2) * I;
      this.head.pitch.kick(0.26 * strength * (Math.random() < 0.8 ? 1 : -0.6));
      if (Math.random() < 0.55) this.brow.kick(1.7 * strength); else if (Math.random() < 0.3) this.browL.kick(1.5 * strength);
      if (Math.random() < 0.25) this.head.roll.kick(rand(-0.12, 0.12) * strength);
    }
    const talking = voiced && (env.speaking || env.silence < 0.6);

    // ---- emotion ----
    let expr = { smile: this.warmth * (this.mode === 'idle' ? 0.5 : 1), squint: this.warmth * 0.5 };
    const lookHead = { yaw: 0, pitch: 0, roll: 0 }; let lookGaze = [0, 0, 0];
    for (const e of EMOTIONS) {
      if (this.hold[e] > 0) this.hold[e] -= dt; else this.target[e] = ease(this.target[e], 0, dt, e === 'surprise' ? 0.5 : 1.6);
      this.emotion[e] = ease(this.emotion[e], this.target[e], dt, this.target[e] > this.emotion[e] ? (e === 'surprise' ? 0.09 : 0.22) : 0.5);
      const w = this.emotion[e] * I; if (w < 0.01) continue;
      const look = LOOKS[e];
      for (const [k, v] of Object.entries(look)) {
        if (k === 'yaw' || k === 'pitch' || k === 'roll') lookHead[k] += v * w;
        else if (k === 'gazeX') { lookGaze[0] += v * w; lookGaze[2] = Math.max(lookGaze[2], w); } else if (k === 'gazeY') lookGaze[1] += v * w;
        else expr[k] = (expr[k] || 0) + v * w;
      }
    }
    const kf = {};
    // A learned keyframe for an emotion replaces the fitted look for that emotion.
    if (this.keyframes) for (const e of EMOTIONS) if (this.keyframes[e] && this.emotion[e] > 0.02) {
      const w = this.emotion[e] * I; kf[e] = w;
      for (const [k, v] of Object.entries(LOOKS[e])) if (k in expr) expr[k] -= v * w;
    }

    // ---- gestures with their own short timelines ----
    const g = this.gest;
    if (g.laugh > 0) { g.laugh = Math.max(0, g.laugh - dt / 1.3); const k = Math.sin(g.laugh * Math.PI); this.head.pitch.kick(Math.sin(t * 34) * 0.05 * k); expr.mouthOpen = (expr.mouthOpen || 0) + 0.2 * k * (0.6 + 0.4 * Math.sin(t * 34)); expr.squint = (expr.squint || 0) + 0.3 * k; }
    if (g.gasp > 0) { g.gasp = Math.max(0, g.gasp - dt / 0.75); expr.mouthOpen = (expr.mouthOpen || 0) + 0.34 * Math.sin(Math.min(1, (1 - g.gasp) * 3) * Math.PI / 2) * Math.min(1, g.gasp * 3); }
    if (g.sigh > 0) { g.sigh = Math.max(0, g.sigh - dt / 1.2); const k = Math.sin(g.sigh * Math.PI); expr.mouthOpen = (expr.mouthOpen || 0) + 0.1 * k; this.blink.value = Math.max(this.blink.value, 0.35 * k); }
    let shake = 0; if (g.shake > 0) { g.shake = Math.max(0, g.shake - dt / 0.9); shake = Math.sin((1 - g.shake) * Math.PI * 4) * 0.07 * Math.sin(g.shake * Math.PI); }
    if (g.ask > 0) g.ask = Math.max(0, g.ask - dt / 1.1);
    if (this.nodAgain && t > this.nodAgain) { this.head.pitch.kick(0.4); this.nodAgain = 0; }

    // ---- mouth ----
    const speakMix = talking ? 1 : 0;
    const m = this.mouth;
    const jaw = m.jaw.step(talking ? s.open * 0.62 * (0.85 + 0.15 * I) : 0, dt);
    const wide = m.wide.step(talking ? s.wide : 0, dt); const round = m.round.step(talking ? s.round : 0, dt);
    const teeth = m.teeth.step(talking ? s.teeth : 0, dt); const press = m.press.step(talking ? s.press : 0, dt);
    const exprMouth = 1 - 0.35 * speakMix;
    // Learned mouth keyframes (aa / ee / oo) take over from the fitted shapes when present.
    const K = this.keyframes || {};
    let jawOut = Math.max(0, jaw); let wideOut = wide * 0.8; let roundOut = round * 0.85;
    if (K.aa) { kf.aa = clamp01(jawOut / 0.6); jawOut = 0; }
    if (K.ee) { kf.ee = clamp01(wide); wideOut = 0; }
    if (K.oo) { kf.oo = clamp01(round); roundOut = 0; }
    // A portrait that is already smiling has to bring its lips together between syllables.
    const closeJaw = this.rig?.closeJaw || 0;
    if (closeJaw) { this.closing = ease(this.closing || 0, talking ? 1 - clamp01(Math.max(0, jaw) * 5) : 0, dt, 0.05); add('jaw', -closeJaw * 0.92 * this.closing); }
    add('jaw', jawOut + (expr.mouthOpen || 0) + 0.1 * roundOut + 0.03 * teeth);
    add('wide', wideOut); add('round', roundOut);
    add('upperUp', 0.22 * Math.max(0, jaw) + 0.55 * teeth + 0.25 * wide + (expr.upperUp || 0) * exprMouth);
    add('lowerDown', 0.5 * teeth + 0.3 * wide);
    add('press', press * 0.6 + (expr.press || 0) * (1 - speakMix));
    add('smile', (expr.smile || 0) * exprMouth * (1 - 0.5 * round)); add('frown', (expr.frown || 0) * exprMouth);

    // ---- brows ----
    const beat = this.brow.step(0, dt); const beatL = this.browL.step(0, dt);
    const listenLift = this.mode === 'listening' ? 0.08 + 0.1 * clamp01(this.listen.level * 3) : 0;
    const browUp = (expr.browUp || 0) + Math.max(-0.2, beat) * 0.55 + listenLift + g.ask * 0.25;
    add('browUpR', browUp); add('browUpL', browUp + (expr.browUpL || 0) + Math.max(0, beatL) * 0.5);
    both('browIn', expr.browIn || 0); both('browDown', expr.browDown || 0);

    // ---- eyes: gaze ----
    const gz = this.gaze; gz.next -= dt;
    if (gz.next <= 0) {
      const thinking = this.emotion.think > 0.3;
      if (gz.away) { gz.away = false; gz.tx = rand(-0.06, 0.06); gz.ty = rand(-0.05, 0.05); gz.next = rand(1.2, 3.2); }
      else if (talking && !thinking && Math.random() < 0.22) { gz.away = true; gz.tx = rand(0.35, 0.6) * (Math.random() < 0.5 ? -1 : 1); gz.ty = rand(-0.35, 0.15); gz.next = rand(0.45, 1.1); if (Math.random() < 0.6) this.queueBlink(0); }
      else { gz.tx = rand(-0.09, 0.09); gz.ty = rand(-0.07, 0.07); gz.next = this.mode === 'listening' ? rand(0.9, 2.6) : rand(0.5, 1.9); }
    }
    const gx = gz.x.step(gz.tx * (1 - lookGaze[2]) + lookGaze[0], dt); const gy = gz.y.step(gz.ty * (1 - lookGaze[2]) + lookGaze[1], dt);

    // ---- eyes: blink ----
    const b = this.blink; b.next -= dt;
    if (b.t < 0 && b.next <= 0) { b.t = 0; b.dur = rand(0.2, 0.3); b.next = talking ? rand(1.6, 4.4) : this.mode === 'listening' ? rand(2.4, 6) : rand(2, 5.5); if (Math.random() < 0.16) b.queue = 1; }
    let lid = 0;
    if (b.t >= 0) {
      b.t += dt; const p = b.t / b.dur;
      lid = p < 0.32 ? Math.sin((p / 0.32) * Math.PI / 2) : p < 0.42 ? 1 : Math.max(0, 0.5 + 0.5 * Math.cos(((p - 0.42) / 0.58) * Math.PI));
      if (p >= 1) { b.t = -1; if (b.queue) { b.queue = 0; b.next = 0.09; } }
    }
    let wink = 0; if (b.wink > 0) { b.wink += dt / 0.42; wink = Math.sin(Math.min(1, b.wink) * Math.PI); if (b.wink >= 1) b.wink = 0; }
    const lidBase = Math.max(lid, this.blink.value); this.blink.value = 0;
    const squint = (expr.squint || 0); const eyeWide = (expr.eyeWide || 0) + Math.max(0, beat) * 0.12;
    // Lids ride with vertical gaze; looking down lowers them.
    add('blinkR', Math.min(1, lidBase + Math.max(0, gy) * 0.18)); add('blinkL', Math.min(1, Math.max(lidBase, wink) + Math.max(0, gy) * 0.18));
    both('squint', squint * (1 - lidBase)); both('wide', eyeWide * (1 - lidBase));
    both('gazeX', gx); both('gazeY', gy);

    // ---- head ----
    const P = this.phase;
    const sway = this.mode === 'idle' ? 1 : talking ? 1.25 : 0.8;
    const drift = {
      yaw: (Math.sin(t * 0.31 + P[0]) * 0.022 + Math.sin(t * 0.83 + P[1]) * 0.009) * sway,
      pitch: (Math.sin(t * 0.27 + P[2]) * 0.012 + Math.sin(t * 0.71 + P[3]) * 0.006) * sway,
      roll: (Math.sin(t * 0.23 + P[1]) * 0.012 + Math.sin(t * 0.57 + P[0]) * 0.005) * sway,
    };
    const breath = Math.sin(t * 1.55 + P[2]);
    // Listener behaviour: small acknowledging nods while the other person talks.
    const L = this.listen; L.level *= Math.exp(-dt / 0.25);
    if (this.mode === 'listening') {
      const heard = L.level > 0.06;
      if (heard) { L.since += dt; if (L.since > 1.4 && t - L.nodAt > rand(2.2, 4.5)) { L.nodAt = t; this.gesture('nod'); } }
      else { if (L.since > 0.6 && t - L.nodAt > 1.2 && Math.random() < 0.6) { L.nodAt = t; this.gesture('nod'); } L.since = 0; }
    }
    const ps = this.poseShift; const lean = this.mode === 'listening' ? 0.022 : 0;
    const head = {
      yaw: this.head.yaw.step((drift.yaw + ps.yaw + lookHead.yaw + gx * 0.05) * I + shake, dt) ,
      pitch: this.head.pitch.step((drift.pitch + ps.pitch + lookHead.pitch + lean + gy * 0.03) * I, dt),
      roll: this.head.roll.step((drift.roll + ps.roll + lookHead.roll + (this.mode === 'listening' ? 0.018 : 0)) * I, dt),
      x: this.head.x.step(ps.x * I, dt),
      y: this.head.y.step(breath * 0.006 + Math.max(0, jaw) * 0.012, dt),
      scale: breath * 0.0022 + (this.mode === 'listening' ? 0.006 : 0),
    };

    this.pose = applyPack({ shapes, keyframes: kf, head, talking, teeth: Math.max(0, teeth) }, this.rig);
    return this.pose;
  }

  // A new phrase is a natural moment to resettle the head, like a person shifting weight.
  phraseStart(silence) {
    const k = Math.min(1, 0.5 + silence);
    this.poseShift = { yaw: rand(-0.05, 0.05) * k, pitch: rand(-0.018, 0.03) * k, roll: rand(-0.028, 0.028) * k, x: rand(-0.02, 0.02) * k };
    if (Math.random() < 0.5) this.brow.kick(1.4);
    if (Math.random() < 0.35) this.queueBlink(rand(0, 0.15));
  }
}

// Fixed poses for the storyboard and for cues.
export function expressionPose(name, amount = 1) {
  const both = (k, v) => ({ [`${k}R`]: v * amount, [`${k}L`]: v * amount });
  const A = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * amount]));
  const table = {
    neutral: { shapes: {} },
    joy: { shapes: { ...A({ smile: 0.85, upperUp: 0.35, jaw: 0.05 }), ...both('squint', 0.6), ...both('browUp', 0.15) }, head: { roll: 0.02 * amount } },
    sad: { shapes: { ...A({ frown: 0.45 }), ...both('browIn', 0.9), ...both('squint', 0.1) }, head: { roll: 0.035 * amount, pitch: 0.03 * amount } },
    surprise: { shapes: { ...A({ jaw: 0.3 }), ...both('browUp', 0.95), ...both('wide', 0.9) }, head: { pitch: -0.03 * amount } },
    concern: { shapes: { ...A({ press: 0.25 }), ...both('browIn', 0.5), ...both('browDown', 0.3), ...both('squint', 0.22) }, head: { pitch: 0.02 * amount } },
    think: { shapes: { ...A({ press: 0.45, browUpL: 0.4 }), ...both('browDown', 0.2), ...both('gazeX', 0.55), ...both('gazeY', -0.5) }, head: { roll: -0.03 * amount, yaw: 0.04 * amount } },
    aa: { shapes: A({ jaw: 0.66, upperUp: 0.2 }) },
    ee: { shapes: A({ jaw: 0.2, wide: 0.8, upperUp: 0.5, lowerDown: 0.4 }) },
    oo: { shapes: A({ jaw: 0.32, round: 0.9 }) },
    mm: { shapes: A({ press: 0.7 }) },
    blink: { shapes: both('blink', 1) },
  };
  return table[name] || table.neutral;
}

// With a pre-rendered expression pack, the fitted shape units are re-expressed as blends of real
// rendered frames: three axes for the mouth (openness × lip shape × smile) and a set of eye/brow
// states. Whatever the pack cannot show stays on the fitted units.
export function applyPack(pose, rig) {
  const pack = rig?.pack; if (!pack) return pose;
  const sh = { ...pose.shapes }; const kf = { ...(pose.keyframes || {}) };
  const take = (k) => { const v = sh[k] || 0; delete sh[k]; return v; };
  const put = (name, w) => { if (w > 0.003) kf[name] = (kf[name] || 0) + w; };

  // ---- mouth grid ----
  const jaw = take('jaw'); const wide = take('wide'); const round = take('round'); const smile = take('smile');
  take('upperUp'); take('lowerDown'); const press = take('press'); take('tuck');
  const teeth = pose.teeth || 0; // sibilants: teeth together, lips apart
  const open = clamp01(Math.max(jaw / 0.74, 0.2 * teeth) * (1 - 0.6 * clamp01(press)));
  const x = Math.max(-1, Math.min(1, wide * 0.95 + 0.4 * teeth - round * 1.15));
  const s = clamp01(smile / 0.8);
  const stops = pack.mouth.open; let oi = 0; while (oi < stops.length - 2 && open > stops[oi + 1]) oi += 1;
  const ot = clamp01((open - stops[oi]) / (stops[oi + 1] - stops[oi]));
  const vAxis = x >= 0 ? [['m', 1 - x], ['e', x]] : [['m', 1 + x], ['o', -x]];
  for (const [si, sw] of [[0, 1 - s], [1, s]]) for (const [o, ow] of [[oi, 1 - ot], [oi + 1, ot]]) for (const [v, vw] of vAxis) put(`m${si}${o}${v}`, sw * ow * vw);

  // ---- eyes and brows ----
  const blink = Math.max(take('blinkR'), take('blinkL'));
  const browR = take('browUpR'); const browL = take('browUpL'); const browUp = Math.max(0, Math.min(browR, browL));
  if (browR - browUp > 0.01) sh.browUpR = browR - browUp; if (browL - browUp > 0.01) sh.browUpL = browL - browUp;
  const frown = Math.max(take('browDownR'), take('browDownL'));
  const gx = (take('gazeXR') + take('gazeXL')) / 2; const gy = (take('gazeYR') + take('gazeYL')) / 2;
  const squint = Math.max(take('squintR'), take('squintL')); const eyeWide = Math.max(take('wideR'), take('wideL'));
  const upper = { blink: clamp01(blink), browUp: clamp01(browUp / 0.95), frown: clamp01(frown / 0.5), gr: clamp01(gx), gl: clamp01(-gx), gd: clamp01(gy), gu: clamp01(-gy), wide: clamp01(eyeWide - browUp), m10m: clamp01(squint / 0.6) * 0.9 };
  // A blink closes the eyes whatever else they were doing.
  const others = Object.entries(upper).filter(([k]) => k !== 'blink'); const sum = others.reduce((a, [, v]) => a + v, 0);
  const room = 1 - upper.blink; const scale = sum > room ? room / sum : 1;
  put('blink', upper.blink);
  for (const [k, v] of others) if (v * scale > 0.003) kf[k === 'm10m' ? 'eyesSmile' : k] = v * scale;
  return { ...pose, shapes: sh, keyframes: kf };
}
