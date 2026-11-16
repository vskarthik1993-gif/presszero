// Builds an avatar expression pack (atlas.jpg + pack.json + portrait.jpg) from frames rendered by
// render_frames.py, or harvested from video by harvest_frames.py. Runs the same landmark detector the
// browser engine uses, so every frame is registered to the mesh exactly as it will be at runtime.
//
//   1. python render_frames.py <liveportrait_dir> portrait.png landmarks.json frames/ <name=spec ...>
//      or, from a video of the character: harvest_frames.py analyze / select / fill (see its header)
//   2. serve the repo root and the frames directory over HTTP
//   3. node build-pack.mjs <site_url> <frames_url> <out_dir> [slots.json]
//      With harvest_frames.py's slots.json, each frame records its source: a video frame (number and
//      time) or a LivePortrait render (spec).
//
// Frame names: m{smile 0|1}{open 0-3}{shape e|m|o} for the mouth grid; blink, browUp, frown, gl, gr,
// gu, gd, wide for eyes and brows.
import { chromium } from 'playwright';
import fs from 'node:fs';

const [site, framesUrl, outDir, slotsFile] = process.argv.slice(2);
const slots = slotsFile ? JSON.parse(fs.readFileSync(slotsFile, 'utf8')).slots : null;
const source = (name) => {
  const s = slots?.[name]; if (!s) return undefined;
  return s.source === 'video' ? { kind: 'video', frame: s.frame, time: s.time } : { kind: 'liveportrait', spec: s.spec };
};
const OPEN = [0, 0.28, 0.6, 1];
const mouth = []; for (const s of [0, 1]) for (const o of [0, 1, 2, 3]) for (const v of ['e', 'm', 'o']) mouth.push(`m${s}${o}${v}`);
const upper = ['blink', 'browUp', 'frown', 'gl', 'gr', 'gu', 'gd', 'wide'];
const names = [...mouth, ...upper];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[page]', e.message));
await page.goto(`${site}/avatar/`);
const result = await page.evaluate(async ({ names, framesUrl, cols }) => {
  const { detectLandmarks } = await import('./engine/rig.js');
  const load = async (name) => { const image = new Image(); image.crossOrigin = 'anonymous'; image.src = `${framesUrl}/${name}.png`; await image.decode(); return image; };
  const images = []; const points = [];
  for (const name of names) { const image = await load(name); const found = await detectLandmarks(image); images.push(image); points.push(found.points); }
  // One crop for every frame: the union of all face outlines plus a margin.
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const pts of points) for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const mx = (x1 - x0) * 0.07; const my = (y1 - y0) * 0.07;
  const W = images[0].naturalWidth; const H = images[0].naturalHeight;
  const crop = [Math.max(0, Math.floor(x0 - mx)), Math.max(0, Math.floor(y0 - my))];
  crop.push(Math.min(W, Math.ceil(x1 + mx)) - crop[0], Math.min(H, Math.ceil(y1 + my)) - crop[1]);
  const rows = Math.ceil(names.length / cols);
  const atlas = document.createElement('canvas'); atlas.width = cols * crop[2]; atlas.height = rows * crop[3];
  const g = atlas.getContext('2d');
  images.forEach((image, i) => g.drawImage(image, crop[0], crop[1], crop[2], crop[3], (i % cols) * crop[2], Math.floor(i / cols) * crop[3], crop[2], crop[3]));
  const portrait = document.createElement('canvas'); portrait.width = W; portrait.height = H;
  portrait.getContext('2d').drawImage(images[names.indexOf('m00m')], 0, 0);
  const round = (pts) => pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  return { crop, cols, size: [atlas.width, atlas.height], points: points.map(round), atlas: atlas.toDataURL('image/jpeg', 0.9), portrait: portrait.toDataURL('image/jpeg', 0.93) };
}, { names, framesUrl, cols: 8 });
await browser.close();

const frames = names.map((name, i) => ({ name, cell: i, region: name.startsWith('m') ? 'lower' : 'upper', source: source(name), points: result.points[i] }));
// The smiling frame also supplies smiling eyes.
frames.push({ name: 'eyesSmile', cell: names.indexOf('m10m'), region: 'upper', source: source('m10m'), points: result.points[names.indexOf('m10m')] });
const pack = { version: 1, cols: result.cols, cell: [result.crop[2], result.crop[3]], crop: result.crop, mouth: { open: OPEN }, frames };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/pack.json`, JSON.stringify(pack));
fs.writeFileSync(`${outDir}/atlas.jpg`, Buffer.from(result.atlas.split(',')[1], 'base64'));
fs.writeFileSync(`${outDir}/portrait.jpg`, Buffer.from(result.portrait.split(',')[1], 'base64'));
console.log('pack', names.length, 'frames, crop', result.crop.join(','), 'atlas', result.size.join('x'));
