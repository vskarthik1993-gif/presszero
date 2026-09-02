import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const FONT_URL = new URL("../assets/mascot/bold.blob", import.meta.url).href;

/** Voice-concierge studio config: key #bf5f2b @ 45°, pool #e17c41 @ 21% / 83%. */
const KEY_COLOR = 0xbf5f2b;
const POOL_COLOR = 0xe17c41;
const KEY_SWEEP = THREE.MathUtils.degToRad(45);
const POOL_WIDTH = 0.21;
const POOL_INTENSITY = 0.83;
const YAW = THREE.MathUtils.degToRad(9);
const PITCH = THREE.MathUtils.degToRad(3);

function makePlateTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  const metal = ctx.createLinearGradient(0, 0, 512, 220);
  metal.addColorStop(0, "#d8d6d0");
  metal.addColorStop(0.45, "#f2f0ea");
  metal.addColorStop(1, "#b8b4ac");
  ctx.fillStyle = metal;
  ctx.fillRect(0, 0, 512, 220);
  ctx.fillStyle = "#161616";
  ctx.beginPath();
  ctx.ellipse(256, 64, 22, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "700 48px 'Open Sans', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PressZero", 256, 148);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeBrushedMaps() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a8f96";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i += 1) {
    const x = Math.random() * size;
    const alpha = 0.05 + Math.random() * 0.14;
    const light = Math.random() > 0.5;
    ctx.strokeStyle = light ? `rgba(236,240,245,${alpha})` : `rgba(40,44,50,${alpha})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, -8);
    ctx.lineTo(x + (Math.random() - 0.5) * 5, size + 8);
    ctx.stroke();
  }
  const roughness = new THREE.CanvasTexture(canvas);
  roughness.wrapS = THREE.RepeatWrapping;
  roughness.wrapT = THREE.RepeatWrapping;
  roughness.repeat.set(3.2, 1.4);
  roughness.anisotropy = 8;
  roughness.needsUpdate = true;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");
  bctx.fillStyle = "#808080";
  bctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i += 1) {
    const x = Math.random() * size;
    bctx.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
    bctx.lineWidth = 1;
    bctx.beginPath();
    bctx.moveTo(x, 0);
    bctx.lineTo(x + (Math.random() - 0.5) * 3, size);
    bctx.stroke();
  }
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.copy(roughness.repeat);
  bump.needsUpdate = true;
  return { roughness, bump };
}

function buildLobbyEnvFaces() {
  const faces = [];
  for (let i = 0; i < 6; i += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const isTop = i === 2;
    const isBottom = i === 3;
    if (isTop) {
      const rad = ctx.createRadialGradient(128, 128, 8, 128, 128, 150);
      rad.addColorStop(0, "#fff4e8");
      rad.addColorStop(0.18, "#ffd2a4");
      rad.addColorStop(0.42, "#e17c41");
      rad.addColorStop(1, "#2a1a12");
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, 256, 256);
    } else if (isBottom) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#3a2a22");
      grad.addColorStop(1, "#0c0a09");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#f0d0b0");
      grad.addColorStop(0.28, "#bf5f2b");
      grad.addColorStop(0.62, "#6a5348");
      grad.addColorStop(1, "#161210");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgba(225, 124, 65, 0.35)";
      ctx.beginPath();
      ctx.ellipse(128, 36, 48, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    faces.push(canvas);
  }
  return faces;
}

function sampleBreathe(elapsed, speaking) {
  const s = Math.sin(elapsed * 1.15);
  const lift = speaking ? 0.18 : 0.12;
  const squash = speaking ? 0.03 : 0.022;
  const floatPhase = (elapsed % 7.2) / 7.2;
  const float = 0.5 - 0.5 * Math.cos(floatPhase * Math.PI * 2);
  const glow = 0.5 - 0.5 * Math.cos(elapsed * ((Math.PI * 2) / 5.4));
  return {
    posY: s * lift + float * 0.72,
    scaleY: 1 + s * squash,
    scaleX: 1 - s * (squash * 0.5),
    scaleZ: 1 - s * 0.015,
    rotY: Math.sin(elapsed * 0.42) * 0.04,
    glow,
  };
}

export async function createReceptionMascot(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(82, 1, 0.1, 200);
  camera.position.set(0, 0, 36);

  const cube = new THREE.CubeTexture(buildLobbyEnvFaces());
  cube.needsUpdate = true;
  cube.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cube).texture;
  scene.environment = env;
  pmrem.dispose();

  scene.add(new THREE.AmbientLight(0x2c241c, 0.22));
  const hemi = new THREE.HemisphereLight(0xe17c41, 0x1c1410, 0.42);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(KEY_COLOR, 3.4);
  const keyDist = 46;
  const keyElev = THREE.MathUtils.degToRad(36);
  key.position.set(
    Math.sin(KEY_SWEEP) * Math.cos(keyElev) * keyDist,
    Math.sin(keyElev) * keyDist,
    Math.cos(KEY_SWEEP) * Math.cos(keyElev) * keyDist,
  );
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9aa4b0, 0.28);
  fill.position.set(-18, 6, 22);
  scene.add(fill);

  const poolAngle = Math.atan(POOL_WIDTH * 1.35);
  const pool = new THREE.SpotLight(POOL_COLOR, 95 * POOL_INTENSITY, 140, poolAngle, 0.48, 1.6);
  pool.position.set(0, 46, 10);
  pool.target.position.set(0, 10, 0);
  scene.add(pool);
  scene.add(pool.target);

  const poolFill = new THREE.PointLight(POOL_COLOR, 28 * POOL_INTENSITY, 90, 2);
  poolFill.position.set(0, 38, 8);
  scene.add(poolFill);

  const font = await new FontLoader().loadAsync(FONT_URL);
  const geometry = new TextGeometry("0", {
    font,
    size: 40,
    height: 42,
    depth: 42,
    curveSegments: 64,
    bevelEnabled: true,
    bevelThickness: 1,
    bevelSize: 0.55,
    bevelSegments: 24,
  });
  geometry.computeBoundingBox();
  geometry.center();
  geometry.computeVertexNormals();
  try {
    geometry.computeTangents();
  } catch {
    /* TextGeometry without a clean tangent basis still renders as steel. */
  }

  const { roughness, bump } = makeBrushedMaps();
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xb8bec8,
    metalness: 0.96,
    roughness: 0.34,
    roughnessMap: roughness,
    bumpMap: bump,
    bumpScale: 0.18,
    envMap: env,
    envMapIntensity: 1.28,
    clearcoat: 0.12,
    clearcoatRoughness: 0.42,
    anisotropy: 0.82,
    anisotropyRotation: Math.PI / 2,
    specularIntensity: 1,
    specularColor: new THREE.Color("#f3ece4"),
  });
  const mesh = new THREE.Mesh(geometry, material);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(12.4, 5.4),
    new THREE.MeshStandardMaterial({
      map: makePlateTexture(),
      metalness: 0.72,
      roughness: 0.38,
      envMapIntensity: 0.55,
    }),
  );
  plate.position.set(15.6, -13.6, 24);

  const BASE_XY = 0.5;
  const BASE_Z = 0.1;
  const inner = new THREE.Group();
  inner.add(mesh);
  inner.add(plate);
  inner.scale.set(BASE_XY, BASE_XY, BASE_Z);
  inner.rotation.set(PITCH, YAW, 0);

  const outer = new THREE.Group();
  outer.add(inner);
  outer.position.set(0, 8, 0);
  outer.scale.setScalar(0.72);
  scene.add(outer);

  let speaking = false;
  let running = false;
  let frameId = 0;
  let startedAt = 0;

  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width) || innerWidth);
    const h = Math.max(2, Math.round(rect.height) || innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(stamp) {
    if (!running) return;
    if (!startedAt) startedAt = stamp;
    const elapsed = (stamp - startedAt) / 1000;
    const pose = sampleBreathe(elapsed, speaking);
    outer.position.y = 8 + pose.posY * 0.45;
    inner.scale.set(BASE_XY * pose.scaleX, BASE_XY * pose.scaleY, BASE_Z * pose.scaleZ);
    inner.rotation.set(PITCH, YAW + pose.rotY, 0);
    const pulse = speaking ? 1.12 + pose.glow * 0.08 : 1 + pose.glow * 0.05;
    pool.intensity = 95 * POOL_INTENSITY * pulse;
    poolFill.intensity = 28 * POOL_INTENSITY * pulse;
    key.intensity = speaking ? 3.7 : 3.4;
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(render);
  }

  function start() {
    if (running) return;
    running = true;
    resize();
    frameId = requestAnimationFrame(render);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frameId);
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();
  renderer.render(scene, camera);

  return {
    start,
    stop,
    setSpeaking(value) {
      speaking = Boolean(value);
    },
    resize,
  };
}
