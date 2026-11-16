// PressZero Expression Model — streaming audio → mouth shapes.
//
// Voice audio arrives from the voice model a little before it is heard. Each
// chunk is analysed the moment it arrives (10 ms hops) and written to a
// timeline keyed on the audio clock, so by the time a sound plays its mouth
// shape is already waiting. The renderer reads the timeline slightly ahead of
// the playhead, because real lips move before the sound they make.

const N = 512;
const HANN = new Float32Array(N);
for (let i = 0; i < N; i += 1) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
const REV = new Uint16Array(N);
for (let i = 0; i < N; i += 1) { let r = 0; for (let b = 0; b < 9; b += 1) r |= ((i >> b) & 1) << (8 - b); REV[i] = r; }
const COS = new Float32Array(N / 2); const SIN = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i += 1) { COS[i] = Math.cos((2 * Math.PI * i) / N); SIN[i] = Math.sin((2 * Math.PI * i) / N); }

function powerSpectrum(frame, re, im, out) {
  for (let i = 0; i < N; i += 1) { re[REV[i]] = frame[i] * HANN[i]; im[REV[i]] = 0; }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1; const step = N / size;
    for (let start = 0; start < N; start += size) for (let k = 0; k < half; k += 1) {
      const c = COS[k * step]; const s = SIN[k * step]; const a = start + k; const b = a + half;
      const tr = re[b] * c + im[b] * s; const ti = im[b] * c - re[b] * s;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  for (let k = 0; k < N / 2; k += 1) out[k] = re[k] * re[k] + im[k] * im[k];
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const norm = (x, a, b) => clamp01((x - a) / (b - a));

export const FIELDS = ['open', 'wide', 'round', 'teeth', 'press', 'energy'];
const F = FIELDS.length;

export class LipSync {
  constructor({ lead = 0.045 } = {}) {
    this.lead = lead;
    this.re = new Float32Array(N); this.im = new Float32Array(N); this.spec = new Float32Array(N / 2); this.frame = new Float32Array(N);
    this.clear();
    this.peakDb = -22;
  }

  clear() {
    this.times = []; this.data = []; this.cursor = 0;
    this.tail = new Float32Array(0); this.tailTime = 0; this.endTime = -1; this.rate = 0;
    this.prev = null;
  }

  // Drop everything scheduled after `time` (barge-in).
  truncate(time) {
    let n = this.times.length; while (n > 0 && this.times[n - 1] > time) n -= 1;
    this.times.length = n; this.data.length = n * F; this.cursor = Math.min(this.cursor, Math.max(0, n - 1));
    this.tail = new Float32Array(0); this.endTime = -1; this.prev = null;
  }

  // samples: Float32Array mono. startTime: when its first sample will be heard (audio clock, seconds).
  push(samples, sampleRate, startTime) {
    const hop = Math.round(sampleRate * 0.01);
    const contiguous = this.rate === sampleRate && Math.abs(startTime - this.endTime) < 0.012 && this.tail.length;
    let buf; let t0;
    if (contiguous) { buf = new Float32Array(this.tail.length + samples.length); buf.set(this.tail); buf.set(samples, this.tail.length); t0 = this.tailTime; }
    else { buf = samples; t0 = startTime; this.prev = null; }
    this.rate = sampleRate; this.endTime = startTime + samples.length / sampleRate;
    const binHz = sampleRate / N;
    let offset = 0;
    for (; offset + N <= buf.length; offset += hop) {
      this.frame.set(buf.subarray(offset, offset + N));
      this.analyse(t0 + (offset + N / 2) / sampleRate, binHz);
    }
    this.tail = buf.slice(offset); this.tailTime = t0 + offset / sampleRate;
    // Keep the timeline bounded.
    if (this.times.length > 6000) { const cut = this.times.length - 4000; this.times.splice(0, cut); this.data.splice(0, cut * F); this.cursor = Math.max(0, this.cursor - cut); }
  }

  analyse(time, binHz) {
    const { frame, spec } = this;
    let sq = 0; for (let i = 0; i < N; i += 1) sq += frame[i] * frame[i];
    const db = 10 * Math.log10(sq / N + 1e-10);
    powerSpectrum(frame, this.re, this.im, spec);
    const band = (lo, hi) => { let s = 0; const a = Math.max(1, Math.round(lo / binHz)); const b = Math.min(N / 2 - 1, Math.round(hi / binHz)); for (let k = a; k <= b; k += 1) s += spec[k]; return s; };
    const centroid = (lo, hi) => { let s = 0; let m = 0; const a = Math.max(1, Math.round(lo / binHz)); const b = Math.min(N / 2 - 1, Math.round(hi / binHz)); for (let k = a; k <= b; k += 1) { s += spec[k]; m += spec[k] * k; } return s > 0 ? (m / s) * binHz : 0; };
    const total = band(80, 10000) + 1e-12;
    const low = band(120, 900) / total; const sib = band(4200, 10000) / total; const hi = band(2500, 4200) / total;
    const c1 = centroid(200, 1100); const c2 = centroid(900, 3000);
    const f2share = band(1700, 3000) / (band(900, 3000) + 1e-12);
    const nasal = band(120, 420) / total;

    // Loudness relative to this voice's own running peak.
    if (db > this.peakDb) this.peakDb += (db - this.peakDb) * 0.2; else this.peakDb -= 0.012;
    if (this.peakDb < -45) this.peakDb = -45;
    const loud = norm(db, this.peakDb - 30, this.peakDb - 4);
    const speech = norm(db, this.peakDb - 38, this.peakDb - 28);

    const frication = clamp01(norm(sib + hi * 0.5, 0.28, 0.6));
    const voiced = clamp01(1 - frication);
    let open = Math.pow(loud, 0.75) * (0.4 + 0.6 * norm(c1, 400, 700)) * (0.25 + 0.75 * voiced);
    let wide = 0.85 * norm(f2share, 0.38, 0.82) * (1 - 0.6 * norm(c1, 520, 720)) * Math.sqrt(loud) * voiced;
    let round = norm(0.34 - f2share, 0, 0.3) * norm(660 - c1, 0, 260) * Math.sqrt(loud) * voiced;
    // Nasal murmur (m, n): voiced, quiet, nearly all energy below ~400 Hz.
    const murmur = norm(nasal, 0.72, 0.92) * norm(0.75 - loud, 0, 0.35) * speech;
    open *= 1 - 0.85 * murmur; round *= 1 - murmur;
    let teeth = frication * speech;
    wide = Math.max(wide, teeth * 0.45);
    open = Math.max(open * (1 - 0.55 * teeth), teeth * 0.1);
    const press = Math.max(murmur * 0.7, 0);
    if (speech < 0.05) { open = 0; wide = 0; round = 0; teeth = 0; }
    this.times.push(time);
    this.data.push(open, wide, round, teeth, press, loud * speech);
  }

  get lastTime() { return this.times.length ? this.times[this.times.length - 1] : -1; }

  // Is there voice scheduled around this moment?
  active(time) { return this.times.length > 0 && time >= this.times[0] - 0.05 && time <= this.lastTime + 0.06; }

  sample(time, out = {}) {
    const t = time + this.lead; const { times, data } = this; const n = times.length;
    for (const f of FIELDS) out[f] = 0;
    if (!n || t < times[0] - 0.03 || t > times[n - 1] + 0.03) return out;
    let i = Math.min(this.cursor, n - 1);
    while (i > 0 && times[i] > t) i -= 1;
    while (i < n - 1 && times[i + 1] <= t) i += 1;
    this.cursor = i;
    const j = Math.min(n - 1, i + 1);
    const span = times[j] - times[i];
    const k = span > 0 && span < 0.05 ? clamp01((t - times[i]) / span) : 0;
    for (let f = 0; f < F; f += 1) out[FIELDS[f]] = data[i * F + f] * (1 - k) + data[j * F + f] * k;
    return out;
  }
}
