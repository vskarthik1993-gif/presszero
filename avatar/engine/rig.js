// PressZero Expression Model — rig builder.
//
// Turns one portrait into a per-character expression model:
//   * a deformable face mesh registered to the photo (MediaPipe landmarks),
//   * a set of linear shape units (jaw, lips, brows, lids, gaze) fitted to this
//     face's own proportions,
//   * optional learned keyframes: extra photos of the same character whose
//     measured geometry and texture replace the fitted units (see addKeyframe).
//
// Everything here runs once per character. The per-frame path lives in
// renderer.js and performer.js.

const VISION_VERSION = '0.10.14';
const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MAX_SIDE = 1280;

// Landmark index groups (MediaPipe face mesh). "R" is the subject's right
// (image left).
const UO = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const U2 = [76, 184, 74, 73, 72, 11, 302, 303, 304, 408, 306];
const U3 = [62, 183, 42, 41, 38, 12, 268, 271, 272, 407, 292];
const UI = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LO = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const L2 = [76, 77, 90, 180, 85, 16, 315, 404, 320, 307, 306];
const L3 = [62, 96, 89, 179, 86, 15, 316, 403, 319, 325, 292];
const LI = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const EYE = {
  R: { upper: [246, 161, 160, 159, 158, 157, 173], lower: [7, 163, 144, 145, 153, 154, 155], crease: [247, 30, 29, 27, 28, 56, 190], outer: 33, inner: 133, iris: [468, 469, 470, 471, 472] },
  L: { upper: [466, 388, 387, 386, 385, 384, 398], lower: [249, 390, 373, 374, 380, 381, 382], crease: [467, 260, 259, 257, 258, 286, 414], outer: 263, inner: 362, iris: [473, 474, 475, 476, 477] },
};
const BROW = {
  R: { pts: [70, 63, 105, 66, 107, 46, 53, 52, 65, 55], inner: [107, 55], mid: [105, 52], outer: [70, 46] },
  L: { pts: [300, 293, 334, 296, 336, 276, 283, 282, 295, 285], inner: [336, 285], mid: [334, 282], outer: [300, 276] },
};
const STABLE = [33, 133, 362, 263, 168, 6, 197, 195, 5, 4, 127, 356, 234, 454];
const N_FACE = 478;

let visionPromise = null;
let landmarkerPromise = null;

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      visionPromise ||= import(/* @vite-ignore */ `${VISION_URL}/vision_bundle.mjs`);
      const vision = await visionPromise;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
      const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        outputFaceBlendshapes: true,
      });
      let landmarker;
      try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
      return { landmarker, vision };
    })().catch((error) => { landmarkerPromise = null; throw error; });
  }
  return landmarkerPromise;
}

export function warmDetector() { return getLandmarker().then(() => undefined); }

function toCanvas(source, maxSide = MAX_SIDE) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(sw * k));
  canvas.height = Math.max(2, Math.round(sh * k));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function detect(canvas) {
  const { landmarker } = await getLandmarker();
  let result = landmarker.detect(canvas);
  if (!result.faceLandmarks?.length) {
    // Small faces in wide shots: retry on a centre crop scaled up.
    const crop = document.createElement('canvas');
    const cw = canvas.width * 0.6; const ch = canvas.height * 0.7;
    const cx = (canvas.width - cw) / 2; const cy = Math.max(0, canvas.height * 0.05);
    crop.width = Math.round(cw * 1.6); crop.height = Math.round(ch * 1.6);
    crop.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, crop.width, crop.height);
    result = landmarker.detect(crop);
    if (!result.faceLandmarks?.length) return null;
    const pts = result.faceLandmarks[0].map((p) => ({ x: (cx + p.x * cw) / canvas.width, y: (cy + p.y * ch) / canvas.height, z: p.z * cw / canvas.width }));
    return { points: pts, blendshapes: result.faceBlendshapes?.[0]?.categories || [] };
  }
  return { points: result.faceLandmarks[0], blendshapes: result.faceBlendshapes?.[0]?.categories || [] };
}

// ---------- geometry helpers ----------

function tessellationTriangles(vision) {
  const adj = new Map();
  const link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const { start, end } of vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION) { link(start, end); link(end, start); }
  const tris = [];
  for (const [a, ns] of adj) for (const b of ns) if (b > a) for (const c of ns) if (c > b && adj.get(b).has(c)) {
    // A degree-3 vertex inside a triangle makes its enclosing triangle a false clique.
    let enclosing = false;
    for (const d of adj.get(a)) if (d !== b && d !== c && adj.get(b).has(d) && adj.get(c).has(d) && adj.get(d).size === 3) { enclosing = true; break; }
    if (!enclosing) tris.push([a, b, c]);
  }
  return tris;
}

function ovalLoop(vision) {
  const next = new Map();
  for (const { start, end } of vision.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) next.set(start, end);
  const loop = []; let v = 10;
  do { loop.push(v); v = next.get(v); } while (v !== 10 && loop.length < 64);
  return loop;
}

function delaunay(points) {
  // Bowyer–Watson. points: [[x, y], ...] → triangles of indices.
  const n = points.length;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const d = Math.max(maxX - minX, maxY - minY) * 20 + 1;
  const pts = points.concat([[minX - d, minY - d], [minX + 2 * d, minY - d], [minX - d, minY + 2 * d]]);
  const circum = (a, b, c) => {
    const [ax, ay] = pts[a]; const [bx, by] = pts[b]; const [cx, cy] = pts[c];
    const dd = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / dd;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / dd;
    return { a, b, c, x: ux, y: uy, r: (ux - ax) ** 2 + (uy - ay) ** 2 };
  };
  let tris = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i += 1) {
    const [px, py] = pts[i];
    const edges = new Map(); const keep = [];
    for (const t of tris) {
      if ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r) {
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
          const key = u < v ? `${u}_${v}` : `${v}_${u}`;
          if (edges.has(key)) edges.set(key, null); else edges.set(key, [u, v]);
        }
      } else keep.push(t);
    }
    for (const e of edges.values()) if (e) keep.push(circum(e[0], e[1], i));
    tris = keep;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Least-squares similarity transform mapping src → dst (2D point lists).
function fitSimilarity(src, dst) {
  let sx = 0; let sy = 0; let dx = 0; let dy = 0; const n = src.length;
  for (let i = 0; i < n; i += 1) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let a = 0; let b = 0; let norm = 0;
  for (let i = 0; i < n; i += 1) {
    const x = src[i][0] - sx; const y = src[i][1] - sy; const u = dst[i][0] - dx; const v = dst[i][1] - dy;
    a += x * u + y * v; b += x * v - y * u; norm += x * x + y * y;
  }
  a /= norm; b /= norm;
  return (p) => [dx + a * (p[0] - sx) - b * (p[1] - sy), dy + b * (p[0] - sx) + a * (p[1] - sy)];
}

// ---------- rig ----------

export class FaceNotFoundError extends Error {
  constructor() { super('No face found. Use a front-facing portrait with both eyes and the mouth visible.'); this.name = 'FaceNotFoundError'; }
}

export async function buildRig(source) {
  const { vision } = await getLandmarker();
  const canvas = toCanvas(source);
  const found = await detect(canvas);
  if (!found) throw new FaceNotFoundError();
  const W = canvas.width; const H = canvas.height;
  const lm = found.points.map((p) => [p.x * W, p.y * H, p.z * W]);

  // A closed mouth still leaves a hairline between the detected inner-lip rings; weld it shut
  // so nothing of the mouth interior shows at rest.
  const gap0 = UI.reduce((s, u, i) => s + Math.hypot(lm[LI[i]][0] - lm[u][0], lm[LI[i]][1] - lm[u][1]), 0) / UI.length
    / Math.hypot(lm[473][0] - lm[468][0], lm[473][1] - lm[468][1]);
  const photoMouthOpen = gap0 > 0.05;
  if (!photoMouthOpen) for (let i = 1; i < UI.length - 1; i += 1) {
    const u = lm[UI[i]]; const l = lm[LI[i]]; const mid = [(u[0] + l[0]) / 2, (u[1] + l[1]) / 2, (u[2] + l[2]) / 2];
    lm[UI[i]] = mid.slice(); lm[LI[i]] = mid.slice();
  }

  // Face frame.
  const P = (i) => lm[i];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const len = (v) => Math.hypot(v[0], v[1]);
  const irisR = P(468); const irisL = P(473);
  const iod = len(sub(irisL, irisR));
  const r = sub(irisL, irisR).map((v) => v / iod);       // subject-left, image-right
  const d = [-r[1], r[0]];                                // down the face
  if (d[0] * (P(152)[0] - P(10)[0]) + d[1] * (P(152)[1] - P(10)[1]) < 0) { d[0] = -d[0]; d[1] = -d[1]; }
  const oval = ovalLoop(vision);
  const centre = [0, 0];
  for (const i of oval) { centre[0] += P(i)[0] / oval.length; centre[1] += P(i)[1] / oval.length; }
  const M = [(P(13)[0] + P(14)[0]) / 2, (P(13)[1] + P(14)[1]) / 2];
  const lat = (p) => ((p[0] - M[0]) * r[0] + (p[1] - M[1]) * r[1]) / iod;
  const drop = (p) => ((p[0] - M[0]) * d[0] + (p[1] - M[1]) * d[1]) / iod;
  const zOval = oval.reduce((s, i) => s + P(i)[2], 0) / oval.length;

  // ---- vertices: face landmarks, then surround, then inner-mouth props ----
  const verts = lm.map((p) => [p[0], p[1], p[2]]);
  const headW = new Array(N_FACE).fill(1);
  const follow = new Array(N_FACE).fill(null); // surround vertices follow an oval vertex
  const ovalPoly = oval.map((i) => [P(i)[0], P(i)[1]]);
  const surround = [];
  const rings = [[1.16, 0.96, 0.55], [1.42, 0.8, 0.3], [1.85, 0.5, 0.12], [2.5, 0.2, 0]];
  rings.forEach(([k, w, f], ringIndex) => {
    oval.forEach((oi, n) => {
      if (ringIndex > 0 && (n + ringIndex) % 2) return;
      const x = centre[0] + (P(oi)[0] - centre[0]) * k; const y = centre[1] + (P(oi)[1] - centre[1]) * k;
      if (x < 2 || y < 2 || x > W - 2 || y > H - 2) return;
      const below = Math.max(0, ((x - centre[0]) * d[0] + (y - centre[1]) * d[1]) / Math.hypot(x - centre[0], y - centre[1]));
      surround.push({ x, y, w: w * (1 - 0.55 * below * below), follow: [oi, f] });
    });
  });
  const stepsX = Math.max(4, Math.round(W / (iod * 0.9))); const stepsY = Math.max(4, Math.round(H / (iod * 0.9)));
  for (let i = 0; i <= stepsX; i += 1) { surround.push({ x: (W * i) / stepsX, y: 0, w: 0 }, { x: (W * i) / stepsX, y: H, w: 0 }); }
  for (let j = 1; j < stepsY; j += 1) { surround.push({ x: 0, y: (H * j) / stepsY, w: 0 }, { x: W, y: (H * j) / stepsY, w: 0 }); }
  // Interior fill so the far background/shoulders have a few anchors.
  for (let i = 1; i < stepsX; i += 1) for (let j = 1; j < stepsY; j += 1) {
    const x = (W * i) / stepsX; const y = (H * j) / stepsY;
    const rr = Math.hypot(x - centre[0], y - centre[1]) / iod;
    if (rr > 3.4) surround.push({ x, y, w: 0 });
  }
  const surroundStart = verts.length;
  for (const s of surround) { verts.push([s.x, s.y, zOval]); headW.push(s.w); follow.push(s.follow || null); }

  // ---- triangles ----
  const faceTris = tessellationTriangles(vision);
  const eyeTris = [];
  for (const side of ['R', 'L']) {
    const e = EYE[side];
    const ring = [e.outer, ...e.upper, e.inner, ...e.lower.slice().reverse()];
    const poly = ring.map((i) => [P(i)[0], P(i)[1]]);
    const ids = ring.concat(e.iris.filter((i) => inPolygon(P(i)[0], P(i)[1], poly)));
    for (const t of delaunay(ids.map((i) => [P(i)[0], P(i)[1]]))) {
      const cx = (P(ids[t[0]])[0] + P(ids[t[1]])[0] + P(ids[t[2]])[0]) / 3;
      const cy = (P(ids[t[0]])[1] + P(ids[t[1]])[1] + P(ids[t[2]])[1]) / 3;
      if (inPolygon(cx, cy, poly)) eyeTris.push(t.map((k) => ids[k]));
    }
  }
  const outerIds = oval.concat(surround.map((_, i) => surroundStart + i));
  const outerTris = [];
  for (const t of delaunay(outerIds.map((i) => [verts[i][0], verts[i][1]]))) {
    const ids = t.map((k) => outerIds[k]);
    const cx = (verts[ids[0]][0] + verts[ids[1]][0] + verts[ids[2]][0]) / 3;
    const cy = (verts[ids[0]][1] + verts[ids[1]][1] + verts[ids[2]][1]) / 3;
    if (!inPolygon(cx, cy, ovalPoly)) outerTris.push(ids);
  }
  const mouthTris = [];
  for (let i = 0; i < 10; i += 1) {
    if (UI[i] !== LI[i]) mouthTris.push([UI[i], UI[i + 1], LI[i]]);
    if (UI[i + 1] !== LI[i + 1]) mouthTris.push([UI[i + 1], LI[i + 1], LI[i]]);
  }

  // ---- inner-mouth props (teeth, tongue, cavity) as extra quads ----
  const hw = len(sub(P(308), P(78))) / 2;
  const neutralGap = gap0; const centreGap = len(sub(P(14), P(13))) / iod;
  const props = [];
  const at = (a, b) => [M[0] + (r[0] * a + d[0] * b) * iod, M[1] + (r[1] * a + d[1] * b) * iod];
  const hwn = hw / iod;
  const addQuad = (name, x0, x1, y0, y1, jaw, uvRect) => {
    const start = verts.length;
    for (const [a, b] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const p = at(a, b); verts.push([p[0], p[1], P(13)[2] + iod * 0.12]); headW.push(1); follow.push(null); }
    props.push({ name, start, jaw, uv: uvRect });
  };
  const lipY = photoMouthOpen ? centreGap / 2 : 0; // lower inner lip, relative to the mouth centre
  addQuad('cavity', -hwn * 1.25, hwn * 1.25, -0.2 - lipY, 0.75 + lipY, 0.55, [0, 0.5, 0.5, 1]);
  addQuad('tongue', -hwn * 0.82, hwn * 0.82, lipY + 0.005, lipY + 0.5, 0.6, [0.5, 0.5, 1, 1]);
  addQuad('lower', -hwn * 0.74, hwn * 0.74, lipY + 0.012, lipY + 0.2, 1, [0, 0.25, 1, 0.5]);
  if (!photoMouthOpen) addQuad('upper', -hwn * 0.86, hwn * 0.86, -0.22, 0.034, 0, [0, 0, 1, 0.25]);
  // Open-mouth portrait: copies of the inner-lip ring that stay with the skull, textured with the
  // portrait's own teeth and drawn behind the lips.
  const fixedMouthTris = [];
  if (photoMouthOpen) {
    const copy = new Map();
    for (const i of new Set([...UI, ...LI])) { copy.set(i, verts.length); verts.push(lm[i].slice()); headW.push(1); follow.push(null); }
    for (const t of mouthTris) fixedMouthTris.push(t.map((i) => copy.get(i)));
    // The top edge of that layer rides with the upper lip so no gap opens above the teeth.
    for (const i of UI) follow[copy.get(i)] = [i, 1, 'lip'];
  }

  const nV = verts.length;
  const pos0 = new Float32Array(nV * 3);
  const uv0 = new Float32Array(nV * 2);
  verts.forEach((v, i) => { pos0.set(v, i * 3); uv0[i * 2] = v[0] / W; uv0[i * 2 + 1] = v[1] / H; });

  // ---- shape units ----
  const shapes = {};
  const blank = () => new Float32Array(nV * 2);
  const vec = (a, b) => [(r[0] * a + d[0] * b) * iod, (r[1] * a + d[1] * b) * iod]; // a: toward subject-left, b: down
  const addTo = (D, i, v, w = 1) => { D[i * 2] += v[0] * w; D[i * 2 + 1] += v[1] * w; };
  // Gaussian field around one or more centres (max, not sum, so strokes do not double up).
  const field = (D, centres, v, sigma, mask) => {
    const s2 = 2 * (sigma * iod) ** 2;
    for (let i = 0; i < N_FACE; i += 1) {
      let w = 0;
      for (const c of centres) { const g = Math.exp(-((lm[i][0] - c[0]) ** 2 + (lm[i][1] - c[1]) ** 2) / s2); if (g > w) w = g; }
      if (mask) w *= mask(i);
      if (w > 0.004) addTo(D, i, v, w);
    }
  };
  const lipK = [0, 0.38, 0.72, 0.93, 1, 1, 1, 0.93, 0.72, 0.38, 0];
  const upperSet = new Map(); const lowerSet = new Map();
  for (const list of [UO, U2, U3, UI]) list.forEach((v, i) => upperSet.set(v, lipK[i]));
  for (const list of [LO, L2, L3, LI]) list.forEach((v, i) => lowerSet.set(v, lipK[i]));
  const corners = new Set([61, 76, 62, 78, 291, 306, 292, 308]);
  const eyeLidSet = new Set(); for (const s of ['R', 'L']) for (const i of [...EYE[s].upper, ...EYE[s].lower, EYE[s].outer, EYE[s].inner, ...EYE[s].iris]) eyeLidSet.add(i);
  const notEye = (i) => (eyeLidSet.has(i) ? 0 : 1);

  // Jaw: everything hanging from the mandible swings down; the upper lip stays.
  const jawWeight = new Float32Array(nV);
  for (let i = 0; i < N_FACE; i += 1) {
    let w;
    if (corners.has(i)) w = 0.42;
    else if (lowerSet.has(i)) w = 0.42 + 0.58 * lowerSet.get(i);
    else if (upperSet.has(i)) w = 0;
    else {
      const h = drop(lm[i]); const x = Math.abs(lat(lm[i]));
      w = smooth(-0.22, 0.2, h);
      if (h < 0.02) w *= smooth(hwn * 0.85, hwn * 1.5, x);
      w *= 1 - 0.55 * smooth(0.75, 1.35, x);
    }
    jawWeight[i] = w;
  }
  const jaw = blank(); const jawV = vec(0, 0.36);
  for (let i = 0; i < N_FACE; i += 1) if (jawWeight[i]) addTo(jaw, i, jawV, jawWeight[i]);
  for (const p of props) for (let k = 0; k < 4; k += 1) addTo(jaw, p.start + k, jawV, p.jaw);
  shapes.jaw = jaw;

  const cornerR = P(61); const cornerL = P(291);
  const lipMask = (i) => notEye(i) * smooth(-0.95, -0.45, drop(lm[i]));
  const mk = (build) => { const D = blank(); build(D); return D; };
  shapes.wide = mk((D) => { field(D, [cornerR], vec(-0.085, -0.008), 0.2, lipMask); field(D, [cornerL], vec(0.085, -0.008), 0.2, lipMask); });
  shapes.smile = mk((D) => {
    field(D, [cornerR], vec(-0.085, -0.095), 0.27, lipMask); field(D, [cornerL], vec(0.085, -0.095), 0.27, lipMask);
    const cheekR = [cornerR[0] + vec(-0.18, -0.42)[0], cornerR[1] + vec(-0.18, -0.42)[1]];
    const cheekL = [cornerL[0] + vec(0.18, -0.42)[0], cornerL[1] + vec(0.18, -0.42)[1]];
    field(D, [cheekR, cheekL], vec(0, -0.045), 0.26, notEye);
  });
  shapes.frown = mk((D) => { field(D, [cornerR], vec(0.02, 0.075), 0.2, lipMask); field(D, [cornerL], vec(-0.02, 0.075), 0.2, lipMask); });
  shapes.round = mk((D) => {
    field(D, [cornerR], vec(0.135, 0), 0.2, lipMask); field(D, [cornerL], vec(-0.135, 0), 0.2, lipMask);
    UO.forEach((v, i) => addTo(D, v, vec(0, -0.022), lipK[i])); U2.forEach((v, i) => addTo(D, v, vec(0, -0.012), lipK[i]));
    LO.forEach((v, i) => addTo(D, v, vec(0, 0.03), lipK[i])); L2.forEach((v, i) => addTo(D, v, vec(0, 0.016), lipK[i]));
  });
  const liftLips = (lists, amounts) => mk((D) => {
    lists.forEach((list, n) => list.forEach((v, i) => addTo(D, v, vec(0, amounts[n]), lipK[i])));
  });
  shapes.upperUp = liftLips([UO, U2, U3, UI], [-0.03, -0.04, -0.05, -0.055]);
  field(shapes.upperUp, [P(164) || P(0)], vec(0, -0.02), 0.16, (i) => (upperSet.has(i) || lowerSet.has(i) ? 0 : notEye(i)));
  shapes.lowerDown = liftLips([LO, L2, L3, LI], [0.03, 0.04, 0.05, 0.055]);
  shapes.press = liftLips([UO, U2, LO, L2], [0.012, 0.006, -0.016, -0.008]);
  // Lower lip tucked up and back toward the upper teeth (f, v).
  shapes.tuck = liftLips([LO, L2, L3, LI], [-0.012, -0.02, -0.028, -0.03]);

  for (const side of ['R', 'L']) {
    const b = BROW[side]; const sgn = side === 'R' ? -1 : 1;
    const pts = b.pts.map(P);
    const browMask = (i) => notEye(i) * (1 - smooth(-0.1, 0.25, ((lm[i][0] - pts[2][0]) * d[0] + (lm[i][1] - pts[2][1]) * d[1]) / iod - 0.12));
    shapes[`browUp${side}`] = mk((D) => field(D, pts, vec(0, -0.1), 0.15, browMask));
    shapes[`browIn${side}`] = mk((D) => field(D, b.inner.map(P), vec(0, -0.095), 0.13, browMask));
    shapes[`browDown${side}`] = mk((D) => { field(D, pts, vec(0, 0.05), 0.13, browMask); field(D, b.inner.map(P), vec(-sgn * 0.035, 0.015), 0.12, browMask); });

    const e = EYE[side];
    const up = e.upper.map(P); const lo = e.lower.map(P);
    const closed = up.map((u, i) => [u[0] + (lo[i][0] - u[0]) * 0.9, u[1] + (lo[i][1] - u[1]) * 0.9]);
    const line = [P(e.outer).slice(0, 2), ...closed, P(e.inner).slice(0, 2)];
    const along = (p) => (p[0] - line[0][0]) * r[0] + (p[1] - line[0][1]) * r[1];
    const closedAt = (p) => {
      const x = along(p); const xs = line.map(along);
      for (let k = 0; k < line.length - 1; k += 1) {
        const a = xs[k]; const c = xs[k + 1];
        if ((x - a) * (x - c) <= 0 && a !== c) { const t = (x - a) / (c - a); return [line[k][0] + (line[k + 1][0] - line[k][0]) * t, line[k][1] + (line[k + 1][1] - line[k][1]) * t]; }
      }
      return line[Math.abs(x - xs[0]) < Math.abs(x - xs[xs.length - 1]) ? 0 : line.length - 1];
    };
    shapes[`blink${side}`] = mk((D) => {
      e.upper.forEach((v, i) => addTo(D, v, sub(closed[i], up[i])));
      e.lower.forEach((v, i) => addTo(D, v, sub(closed[i], lo[i])));
      e.crease.forEach((v, i) => addTo(D, v, sub(closed[i], up[i]), 0.5));
      for (const v of e.iris) {
        const c = closedAt(P(v)); const dy = (c[0] - P(v)[0]) * d[0] + (c[1] - P(v)[1]) * d[1];
        addTo(D, v, [d[0] * dy, d[1] * dy]);
      }
      field(D, b.pts.map(P), vec(0, 0.012), 0.1, browMask);
    });
    shapes[`wide${side}`] = mk((D) => {
      const arc = [0.4, 0.8, 1, 1, 1, 0.8, 0.4];
      e.upper.forEach((v, i) => addTo(D, v, vec(0, -0.032), arc[i])); e.crease.forEach((v, i) => addTo(D, v, vec(0, -0.02), arc[i]));
      e.lower.forEach((v, i) => addTo(D, v, vec(0, 0.008), arc[i]));
    });
    shapes[`squint${side}`] = mk((D) => {
      const arc = [0.4, 0.8, 1, 1, 1, 0.8, 0.4];
      e.lower.forEach((v, i) => addTo(D, v, vec(0, -0.036), arc[i])); e.upper.forEach((v, i) => addTo(D, v, vec(0, 0.014), arc[i]));
      field(D, [[P(e.lower[3])[0] + d[0] * iod * 0.16, P(e.lower[3])[1] + d[1] * iod * 0.16]], vec(0, -0.02), 0.14, notEye);
    });
    shapes[`gazeX${side}`] = mk((D) => { for (const v of e.iris) addTo(D, v, vec(0.06, 0)); });
    shapes[`gazeY${side}`] = mk((D) => {
      for (const v of e.iris) addTo(D, v, vec(0, 0.04));
      const arc = [0.3, 0.7, 1, 1, 1, 0.7, 0.3];
      e.upper.forEach((v, i) => addTo(D, v, vec(0, 0.018), arc[i]));
    });
  }

  // Skin just outside the face follows the nearest oval vertex.
  const propagate = (D, name) => {
    for (let i = surroundStart; i < nV; i += 1) {
      const f = follow[i]; if (!f || (f[2] === 'lip' && name === 'jaw')) continue;
      D[i * 2] = D[f[0] * 2] * f[1]; D[i * 2 + 1] = D[f[0] * 2 + 1] * f[1];
    }
    return D;
  };
  for (const name of Object.keys(shapes)) propagate(shapes[name], name);

  // ---- colour sampling for the mouth interior ----
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const sample = (p, radius) => {
    const x = Math.max(0, Math.min(W - radius, Math.round(p[0] - radius / 2))); const y = Math.max(0, Math.min(H - radius, Math.round(p[1] - radius / 2)));
    const data = ctx.getImageData(x, y, radius, radius).data; let R = 0; let G = 0; let B = 0;
    for (let i = 0; i < data.length; i += 4) { R += data[i]; G += data[i + 1]; B += data[i + 2]; }
    const n = data.length / 4; return [R / n, G / n, B / n];
  };
  const patch = Math.max(3, Math.round(iod * 0.08));
  const skin = [sample(P(205), patch), sample(P(425), patch), sample(P(6), patch)].reduce((a, c) => a.map((v, i) => v + c[i] / 3), [0, 0, 0]);
  const lip = [sample(P(16), patch), sample(P(11), patch)].reduce((a, c) => a.map((v, i) => v + c[i] / 2), [0, 0, 0]);

  // Per-vertex region masks used when blending learned keyframes.
  const distToOval = (p) => {
    let best = Infinity;
    for (let i = 0; i < ovalPoly.length; i += 1) {
      const a = ovalPoly[i]; const b2 = ovalPoly[(i + 1) % ovalPoly.length];
      const vx = b2[0] - a[0]; const vy = b2[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy)));
      best = Math.min(best, Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t));
    }
    return best;
  };
  const regions = { face: new Float32Array(nV), mouth: new Float32Array(nV), eyes: new Float32Array(nV) };
  const eyeMid = [(irisR[0] + irisL[0]) / 2, (irisR[1] + irisL[1]) / 2];
  for (let i = 0; i < N_FACE; i += 1) {
    const edge = smooth(0.02, 0.3, distToOval(lm[i]) / iod);
    regions.face[i] = edge;
    const md = Math.hypot(lat(lm[i]) / 1.25, drop(lm[i]) - 0.1);
    regions.mouth[i] = edge * (1 - smooth(0.42, 0.78, md));
    const ed = ((lm[i][0] - eyeMid[0]) * d[0] + (lm[i][1] - eyeMid[1]) * d[1]) / iod;
    regions.eyes[i] = edge * (1 - smooth(0.25, 0.5, Math.abs(ed + 0.08)));
  }

  return {
    canvas, W, H, nV, nFace: N_FACE, pos0, uv0, headW: Float32Array.from(headW),
    tris: { face: faceTris.concat(eyeTris), outer: outerTris, mouth: mouthTris },
    props, shapes, regions, propagate, landmarks: lm, iod, axes: { r, d }, centre, mouth: M,
    pivot: [centre[0] + d[0] * iod * 0.55, centre[1] + d[1] * iod * 0.55, zOval + iod * 0.9],
    neutralGap, photoMouthOpen, fixedMouthTris, closeJaw: photoMouthOpen ? Math.min(0.6, centreGap / 0.36) : 0, skin, lip, blendshapes: found.blendshapes,
    keyframes: {},
  };
}

// Learn one keyframe: another image of the same character holding an expression
// or a mouth shape. Its landmarks give the true geometry for that pose and its
// pixels give the true appearance (teeth, creases, lid folds).
export async function addKeyframe(rig, name, source, { region = 'face' } = {}) {
  const canvas = toCanvas(source);
  const found = await detect(canvas);
  if (!found) throw new FaceNotFoundError();
  const W = canvas.width; const H = canvas.height;
  const pts = found.points.map((p) => [p.x * W, p.y * H]);
  const align = fitSimilarity(STABLE.map((i) => pts[i]), STABLE.map((i) => rig.landmarks[i]));
  const delta = new Float32Array(rig.nV * 2);
  const uv = new Float32Array(rig.nV * 2);
  for (let i = 0; i < rig.nFace; i += 1) {
    const p = align(pts[i]);
    delta[i * 2] = p[0] - rig.landmarks[i][0]; delta[i * 2 + 1] = p[1] - rig.landmarks[i][1];
    uv[i * 2] = pts[i][0] / W; uv[i * 2 + 1] = pts[i][1] / H;
  }
  if (region === 'mouth') for (let i = 0; i < rig.nFace; i += 1) { const m = rig.regions.mouth[i] > 0 ? Math.min(1, rig.regions.mouth[i] * 1.6) : 0; delta[i * 2] *= m; delta[i * 2 + 1] *= m; }
  rig.propagate(delta);
  // Inner-mouth props ride along with the learned jaw drop.
  const jawDrop = (delta[14 * 2] * rig.axes.d[0] + delta[14 * 2 + 1] * rig.axes.d[1]);
  for (const p of rig.props) for (let k = 0; k < 4; k += 1) { const i = p.start + k; delta[i * 2] = rig.axes.d[0] * jawDrop * p.jaw; delta[i * 2 + 1] = rig.axes.d[1] * jawDrop * p.jaw; }
  rig.keyframes[name] = { name, region, canvas, uv, delta, version: (rig.keyframes[name]?.version || 0) + 1 };
  return rig.keyframes[name];
}

export function removeKeyframe(rig, name) { delete rig.keyframes[name]; }
