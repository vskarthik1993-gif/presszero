// PressZero Expression Model — real-time renderer.
//
// One draw per frame of a few hundred triangles: the photo is the texture, the
// expression model moves the vertices. Learned keyframes are drawn as extra
// alpha passes over the same deformed geometry, each sampling its own image
// through its own landmark-registered UVs, so they stay pixel-aligned.

const VS = `
attribute vec2 aPos; attribute vec2 aUV; attribute float aAlpha;
uniform vec4 uView; varying vec2 vUV; varying float vAlpha;
void main() {
  vUV = aUV; vAlpha = aAlpha;
  vec2 p = (aPos - uView.xy) / uView.zw;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform float uAlpha; uniform vec3 uTint;
varying vec2 vUV; varying float vAlpha;
void main() {
  vec4 c = texture2D(uTex, vUV);
  gl_FragColor = vec4(c.rgb * uTint, c.a) * (uAlpha * vAlpha);
}`;

function drawMouthAtlas(rig) {
  const S = 512; const c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d');
  const lum = (rig.skin[0] * 0.3 + rig.skin[1] * 0.59 + rig.skin[2] * 0.11) / 255;
  const light = Math.min(1, Math.max(0.55, 0.5 + 0.55 * lum));
  const tooth = [244, 238, 228].map((v) => v * light * 0.93);
  const lip = rig.lip;
  const rgb = (v, k = 1, a = 1) => `rgba(${v.map((x) => Math.round(Math.min(255, x * k))).join(',')},${a})`;
  const gum = [lip[0] * 0.62 + 30, lip[1] * 0.45 + 8, lip[2] * 0.45 + 12];

  const teethRow = (y0, h, upper) => {
    g.save(); g.beginPath(); g.rect(0, y0, S, h); g.clip();
    g.fillStyle = rgb(upper ? gum : tooth, upper ? 0.95 : 0.8); g.fillRect(0, y0, S, h);
    const widths = upper ? [0.6, 0.68, 0.78, 0.9, 1.1, 1.1, 0.9, 0.78, 0.68, 0.6] : [0.7, 0.74, 0.78, 0.8, 0.8, 0.8, 0.8, 0.78, 0.74, 0.7];
    const total = widths.reduce((a, b) => a + b, 0); let x = S * 0.03; const span = S * 0.94;
    const th = h * (upper ? 0.66 : 0.62);
    widths.forEach((w, i) => {
      const tw = (span * w) / total; const centreBias = 1 - Math.abs((i + 0.5) / widths.length - 0.5) * 0.9;
      const tall = th * (upper ? 0.78 + 0.22 * centreBias : 0.9);
      const ty = upper ? y0 + h - tall - h * 0.02 * (1 - centreBias) : y0;
      // Each tooth is a slightly rounded cylinder: lit in the middle, darker at its sides.
      const body = g.createLinearGradient(x, 0, x + tw, 0);
      body.addColorStop(0, rgb(tooth, 0.9)); body.addColorStop(0.25, rgb(tooth, 1)); body.addColorStop(0.75, rgb(tooth, 1)); body.addColorStop(1, rgb(tooth, 0.9));
      g.fillStyle = body; const rad = tw * 0.3;
      g.beginPath();
      if (upper) g.roundRect(x + 0.25, ty - rad, tw - 0.5, tall + rad, [0, 0, rad, rad]);
      else g.roundRect(x + 0.25, ty, tw - 0.5, tall + rad, [rad, rad, 0, 0]);
      g.fill();
      x += tw;
    });
    // The lip throws a soft shadow on the teeth nearest to it.
    const shade = g.createLinearGradient(0, y0, 0, y0 + h);
    if (upper) { shade.addColorStop(0, 'rgba(30,10,10,0.4)'); shade.addColorStop(0.45, 'rgba(30,10,10,0.2)'); shade.addColorStop(0.8, 'rgba(30,10,10,0.05)'); shade.addColorStop(1, 'rgba(30,10,10,0)'); }
    else { shade.addColorStop(0, 'rgba(30,10,10,0.22)'); shade.addColorStop(0.4, 'rgba(30,10,10,0.4)'); shade.addColorStop(1, 'rgba(30,10,10,0.7)'); }
    g.fillStyle = shade; g.fillRect(0, y0, S, h);
    // Teeth curve away from the light toward the corners of the mouth.
    const side = g.createLinearGradient(0, 0, S, 0);
    side.addColorStop(0, 'rgba(14,5,5,0.95)'); side.addColorStop(0.14, 'rgba(14,5,5,0.55)'); side.addColorStop(0.34, 'rgba(14,5,5,0.04)');
    side.addColorStop(0.66, 'rgba(14,5,5,0.04)'); side.addColorStop(0.86, 'rgba(14,5,5,0.55)'); side.addColorStop(1, 'rgba(14,5,5,0.95)');
    g.fillStyle = side; g.fillRect(0, y0, S, h);
    g.restore();
  };
  teethRow(0, S / 4, true);
  teethRow(S / 4, S / 4, false);

  // Cavity.
  const cav = g.createRadialGradient(S * 0.25, S * 0.7, 4, S * 0.25, S * 0.7, S * 0.3);
  cav.addColorStop(0, rgb([lip[0] * 0.3, lip[1] * 0.16, lip[2] * 0.16])); cav.addColorStop(1, rgb([lip[0] * 0.1, lip[1] * 0.05, lip[2] * 0.05]));
  g.fillStyle = cav; g.fillRect(0, S / 2, S / 2, S / 2);
  // Tongue.
  const tx = S * 0.75; const ty = S * 0.78;
  const tg = g.createRadialGradient(tx, ty - S * 0.08, 6, tx, ty, S * 0.25);
  const tongue = [lip[0] * 0.78 + 28, lip[1] * 0.5 + 8, lip[2] * 0.5 + 12];
  tg.addColorStop(0, rgb(tongue, 0.72 * light)); tg.addColorStop(0.7, rgb(tongue, 0.42 * light)); tg.addColorStop(1, rgb(tongue, 0.3 * light, 0));
  g.fillStyle = tg; g.beginPath(); g.ellipse(tx, ty, S * 0.235, S * 0.21, 0, 0, Math.PI * 2); g.fill();
  return c;
}

export class AvatarRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.loc = { pos: gl.getAttribLocation(prog, 'aPos'), uv: gl.getAttribLocation(prog, 'aUV'), alpha: gl.getAttribLocation(prog, 'aAlpha'), view: gl.getUniformLocation(prog, 'uView'), tex: gl.getUniformLocation(prog, 'uTex'), a: gl.getUniformLocation(prog, 'uAlpha'), tint: gl.getUniformLocation(prog, 'uTint') };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.rig = null; this.kfGpu = new Map();
  }

  texture(source) {
    const { gl } = this; const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  buffer(data, target = this.gl.ARRAY_BUFFER, usage = this.gl.STATIC_DRAW) {
    const { gl } = this; const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage); return b;
  }

  setRig(rig, { frame = 'auto' } = {}) {
    const { gl } = this;
    this.rig = rig; this.kfGpu.clear();
    this.pos = new Float32Array(rig.nV * 2);
    this.posBuf = this.buffer(this.pos, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    this.uvBuf = this.buffer(rig.uv0);
    this.ones = this.buffer(new Float32Array(rig.nV).fill(1));
    this.regionBuf = {}; for (const [k, v] of Object.entries(rig.regions)) this.regionBuf[k] = this.buffer(v);
    this.photoTex = this.texture(rig.canvas);
    this.atlasTex = this.texture(drawMouthAtlas(rig));
    const flat = (tris) => new Uint16Array(tris.flat());
    const mk = (tris) => ({ buf: this.buffer(flat(tris), gl.ELEMENT_ARRAY_BUFFER), n: tris.length * 3 });
    this.idx = { photo: mk(rig.tris.outer.concat(rig.tris.face)), kf: mk(rig.tris.face.concat(rig.tris.mouth)) };
    // Inner-mouth props: own UVs into the atlas.
    const propUV = new Float32Array(rig.nV * 2); const propIdx = [];
    for (const p of rig.props) {
      const [u0, v0, u1, v1] = p.uv; const s = p.start;
      propUV.set([u0, v0, u1, v0, u1, v1, u0, v1], s * 2);
      propIdx.push([s, s + 1, s + 2], [s, s + 2, s + 3]);
    }
    this.propUV = this.buffer(propUV); this.idx.props = mk(propIdx);
    if (rig.fixedMouthTris.length) this.idx.fixedMouth = mk(rig.fixedMouthTris);
    this.setFrame(frame);
  }

  // Choose what part of the photo the canvas shows.
  setFrame(frame) {
    const { rig } = this; if (!rig) return;
    let view = [0, 0, rig.W, rig.H];
    if (frame === 'auto' || frame === 'head') {
      const aspect = 4 / 5;
      let w = Math.min(rig.W, rig.iod * (frame === 'head' ? 4.2 : 5.6)); let h = w / aspect;
      if (h > rig.H) { h = rig.H; w = Math.min(rig.W, h * aspect); }
      const cx = rig.centre[0]; const cy = rig.centre[1] + rig.iod * 0.35;
      view = [Math.max(0, Math.min(rig.W - w, cx - w / 2)), Math.max(0, Math.min(rig.H - h, cy - h / 2)), w, h];
    }
    this.view = view;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = this.canvas.clientWidth || 480;
    const pxW = Math.round(Math.min(view[2] * 1.25, Math.max(480, cssW * dpr)));
    this.canvas.width = pxW; this.canvas.height = Math.round((pxW * view[3]) / view[2]);
    this.canvas.style.aspectRatio = `${view[2]} / ${view[3]}`;
  }

  syncKeyframes() {
    const { rig } = this;
    for (const [name, gpu] of this.kfGpu) if (!rig.keyframes[name] || rig.keyframes[name].version !== gpu.version) { this.gl.deleteTexture(gpu.tex); this.kfGpu.delete(name); }
    for (const kf of Object.values(rig.keyframes)) if (!this.kfGpu.has(kf.name)) this.kfGpu.set(kf.name, { tex: this.texture(kf.canvas), uv: this.buffer(kf.uv), version: kf.version });
  }

  // pose: { shapes: {name: weight}, keyframes: {name: weight}, head: {yaw, pitch, roll, x, y, scale} }
  render(pose) {
    const { gl, rig } = this; if (!rig) return;
    const n = rig.nV; const out = this.pos; const p0 = rig.pos0;
    for (let i = 0; i < n; i += 1) { out[i * 2] = p0[i * 3]; out[i * 2 + 1] = p0[i * 3 + 1]; }
    const apply = (D, w) => { if (!D || Math.abs(w) < 0.002) return; for (let i = 0; i < n * 2; i += 1) out[i] += D[i] * w; };
    for (const [name, w] of Object.entries(pose.shapes || {})) apply(rig.shapes[name], w);
    const kfs = [];
    for (const [name, w] of Object.entries(pose.keyframes || {})) { const kf = rig.keyframes[name]; if (kf && w > 0.004) { apply(kf.delta, w); kfs.push([kf, Math.min(1, w)]); } }

    const h = pose.head || {};
    const yaw = h.yaw || 0; const pitch = h.pitch || 0; const roll = h.roll || 0; const sc = 1 + (h.scale || 0);
    const sy = Math.sin(yaw); const cyaw = Math.cos(yaw); const sp = Math.sin(pitch); const cp = Math.cos(pitch); const sr = Math.sin(roll); const cr = Math.cos(roll);
    const [px, py, pz] = rig.pivot; const tx = (h.x || 0) * rig.iod; const ty = (h.y || 0) * rig.iod;
    const hw = rig.headW;
    for (let i = 0; i < n; i += 1) {
      const w = hw[i]; if (w === 0) continue;
      const x = out[i * 2] - px; const y = out[i * 2 + 1] - py; const z = p0[i * 3 + 2] - pz;
      const x1 = x * cr - y * sr; const y1 = x * sr + y * cr;
      const x2 = x1 * cyaw - z * sy; const z2 = x1 * sy + z * cyaw;
      const y2 = y1 * cp - z2 * sp;
      out[i * 2] += (x2 * sc + px + tx - out[i * 2]) * w;
      out[i * 2 + 1] += (y2 * sc + py + ty - out[i * 2 + 1]) * w;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
    gl.enableVertexAttribArray(this.loc.pos); gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(this.loc.view, this.view); gl.uniform1i(this.loc.tex, 0); gl.activeTexture(gl.TEXTURE0);
    const pass = (tex, uvBuf, alphaBuf, index, alpha, tint = [1, 1, 1]) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.enableVertexAttribArray(this.loc.uv); gl.vertexAttribPointer(this.loc.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf); gl.enableVertexAttribArray(this.loc.alpha); gl.vertexAttribPointer(this.loc.alpha, 1, gl.FLOAT, false, 0, 0);
      gl.uniform1f(this.loc.a, alpha); gl.uniform3fv(this.loc.tint, tint);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buf); gl.drawElements(gl.TRIANGLES, index.n, gl.UNSIGNED_SHORT, 0);
    };
    pass(this.atlasTex, this.propUV, this.ones, this.idx.props, 1);
    // A portrait that already shows teeth keeps its own teeth, fixed to the skull, behind the lips.
    if (this.idx.fixedMouth) pass(this.photoTex, this.uvBuf, this.ones, this.idx.fixedMouth, 1);
    pass(this.photoTex, this.uvBuf, this.ones, this.idx.photo, 1);
    if (kfs.length) {
      this.syncKeyframes();
      for (const [kf, w] of kfs) { const gpu = this.kfGpu.get(kf.name); pass(gpu.tex, gpu.uv, this.regionBuf[kf.region] || this.regionBuf.face, this.idx.kf, w); }
    }
  }

  snapshot(pose, size = 256) {
    this.render(pose);
    const c = document.createElement('canvas'); c.width = size; c.height = Math.round((size * this.canvas.height) / this.canvas.width);
    c.getContext('2d').drawImage(this.canvas, 0, 0, c.width, c.height);
    return c;
  }
}
