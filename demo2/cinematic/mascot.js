import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const FONT_URL = new URL("../assets/mascot/bold.blob", import.meta.url).href;

/** Voice-concierge studio config: key #bf5f2b @ 45°, pool #e17c41 @ 21% / 83%. */
export const DEFAULT_MASCOT_CONFIG = {
  keyColor: "#bf5f2b",
  keySweep: 45,
  keyIntensity: 100,
  poolColor: "#e17c41",
  poolWidth: 21,
  poolIntensity: 83,
  yaw: 9,
  pitch: 3,
  zoom: 1,
  exposure: 1.38,
  fillIntensity: 155,
  ambientIntensity: 62,
  metalColor: "#e6ebf0",
  metalness: 94,
  roughness: 26,
  envMapIntensity: 155,
  breathe: true,
};

/**
 * Lab starting lights. Fill/env/exposure stay low so key + pool sliders
 * have headroom. Live /demo2 still uses DEFAULT_MASCOT_CONFIG.
 */
export const LAB_STUDIO_CONFIG = {
  ...DEFAULT_MASCOT_CONFIG,
  fillIntensity: 32,
  ambientIntensity: 18,
  envMapIntensity: 72,
  exposure: 1.05,
  keyIntensity: 100,
  poolIntensity: 83,
};

const KEY_DIST = 46;
const KEY_ELEV = THREE.MathUtils.degToRad(36);
const KEY_GAIN = 2.6;
const POOL_GAIN = 140;
const POOL_POINT_GAIN = 42;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

function makePoolGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const rad = ctx.createRadialGradient(128, 128, 6, 128, 128, 124);
  rad.addColorStop(0, "rgba(255,255,255,1)");
  rad.addColorStop(0.22, "rgba(255,230,200,0.75)");
  rad.addColorStop(0.55, "rgba(255,160,80,0.28)");
  rad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 256, 256);
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
  ctx.fillStyle = "#d4dae2";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i += 1) {
    const x = Math.random() * size;
    const alpha = 0.05 + Math.random() * 0.12;
    const light = Math.random() > 0.45;
    ctx.strokeStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(120,128,138,${alpha})`;
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
      rad.addColorStop(0, "#fffaf2");
      rad.addColorStop(0.18, "#ffe2c0");
      rad.addColorStop(0.42, "#e17c41");
      rad.addColorStop(1, "#c8b49a");
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, 256, 256);
    } else if (isBottom) {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#b08a72");
      grad.addColorStop(1, "#7a5848");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#fff4e6");
      grad.addColorStop(0.28, "#ead4b8");
      grad.addColorStop(0.62, "#d2b898");
      grad.addColorStop(1, "#b89a7c");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgba(255, 210, 160, 0.45)";
      ctx.beginPath();
      ctx.ellipse(128, 36, 56, 26, 0, 0, Math.PI * 2);
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

export async function createReceptionMascot(canvas, initialConfig = {}) {
  const cfg = { ...DEFAULT_MASCOT_CONFIG, ...initialConfig };
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
  renderer.toneMappingExposure = cfg.exposure;

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(82, 1, 0.1, 200);
  camera.position.set(0, 0, 36 / Math.max(0.4, cfg.zoom));

  const cube = new THREE.CubeTexture(buildLobbyEnvFaces());
  cube.needsUpdate = true;
  cube.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cube).texture;
  scene.environment = env;
  pmrem.dispose();

  const ambient = new THREE.AmbientLight(0xe8e2d8, num(cfg.ambientIntensity, 62) / 100);
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xfff2e4, 0xa89078, 0.7 * (num(cfg.ambientIntensity, 62) / 62));
  scene.add(hemi);

  const key = new THREE.DirectionalLight(cfg.keyColor, (num(cfg.keyIntensity, 100) / 100) * KEY_GAIN);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xf4f7fb, num(cfg.fillIntensity, 155) / 100);
  fill.position.set(-10, 10, 28);
  scene.add(fill);

  const bounce = new THREE.DirectionalLight(0xffe8d2, 0.85 * (num(cfg.fillIntensity, 155) / 155));
  bounce.position.set(8, -12, 18);
  scene.add(bounce);

  const pool = new THREE.SpotLight(
    cfg.poolColor,
    (num(cfg.poolIntensity, 83) / 100) * POOL_GAIN,
    140,
    Math.atan((num(cfg.poolWidth, 21) / 100) * 1.35),
    0.48,
    1.4,
  );
  pool.target.position.set(0, 10, 0);
  scene.add(pool);
  scene.add(pool.target);

  const poolFill = new THREE.PointLight(
    cfg.poolColor,
    (num(cfg.poolIntensity, 83) / 100) * POOL_POINT_GAIN,
    90,
    1.8,
  );
  poolFill.position.set(0, 38, 8);
  scene.add(poolFill);

  const glowMat = new THREE.MeshBasicMaterial({
    map: makePoolGlowTexture(),
    color: cfg.poolColor,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), glowMat);
  glow.position.set(0, 10, -8);
  glow.rotation.x = -0.72;
  scene.add(glow);

  function placeKey() {
    const sweep = THREE.MathUtils.degToRad(cfg.keySweep);
    key.position.set(
      Math.sin(sweep) * Math.cos(KEY_ELEV) * KEY_DIST,
      Math.sin(KEY_ELEV) * KEY_DIST,
      Math.cos(sweep) * Math.cos(KEY_ELEV) * KEY_DIST,
    );
  }
  placeKey();
  pool.position.set(0, 46, 10);

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
  if (!geometry.getAttribute("uv")) {
    const pos = geometry.getAttribute("position");
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 1) {
      uv[i * 2] = pos.getX(i) * 0.035;
      uv[i * 2 + 1] = pos.getY(i) * 0.035;
    }
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
  let canAniso = false;
  try {
    if (geometry.index && geometry.getAttribute("normal") && geometry.getAttribute("uv")) {
      geometry.computeTangents();
      canAniso = Boolean(geometry.getAttribute("tangent"));
    }
  } catch {
    canAniso = false;
  }

  const { roughness, bump } = makeBrushedMaps();
  const material = new THREE.MeshPhysicalMaterial({
    color: cfg.metalColor,
    metalness: num(cfg.metalness, 94) / 100,
    roughness: num(cfg.roughness, 26) / 100,
    roughnessMap: roughness,
    bumpMap: bump,
    bumpScale: 0.12,
    envMap: env,
    envMapIntensity: num(cfg.envMapIntensity, 155) / 100,
    emissive: new THREE.Color(cfg.poolColor),
    emissiveIntensity: 0.12,
    clearcoat: 0.18,
    clearcoatRoughness: 0.32,
    anisotropy: canAniso ? 0.7 : 0,
    anisotropyRotation: Math.PI / 2,
    specularIntensity: 1,
    specularColor: new THREE.Color("#ffffff"),
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
  inner.rotation.set(THREE.MathUtils.degToRad(cfg.pitch), THREE.MathUtils.degToRad(cfg.yaw), 0);

  const outer = new THREE.Group();
  outer.add(inner);
  outer.position.set(0, 8, 0);
  outer.scale.setScalar(0.72);
  scene.add(outer);

  let speaking = false;
  let running = false;
  let frameId = 0;
  let startedAt = 0;

  function applyLights(pulse = 1) {
    const keyAmt = Math.max(0, num(cfg.keyIntensity, 100) / 100);
    const poolAmt = Math.max(0, num(cfg.poolIntensity, 83) / 100);
    const fillAmt = Math.max(0, num(cfg.fillIntensity, 155) / 100);
    const ambAmt = Math.max(0, num(cfg.ambientIntensity, 62) / 100);
    const poolW = Math.max(0.04, num(cfg.poolWidth, 21) / 100);
    const keyHex = cfg.keyColor || "#bf5f2b";
    const poolHex = cfg.poolColor || "#e17c41";

    key.color.set(keyHex);
    placeKey();
    key.intensity = keyAmt * KEY_GAIN * (speaking ? 1.12 : 1);

    fill.intensity = fillAmt;
    bounce.intensity = 0.85 * (num(cfg.fillIntensity, 155) / 155);
    ambient.intensity = ambAmt;
    hemi.intensity = 0.7 * (num(cfg.ambientIntensity, 62) / 62);

    pool.color.set(poolHex);
    pool.angle = Math.max(0.05, Math.atan(poolW * 1.35));
    pool.position.set(0, 46, 10);
    pool.intensity = poolAmt * POOL_GAIN * pulse;
    poolFill.color.set(poolHex);
    poolFill.intensity = poolAmt * POOL_POINT_GAIN * pulse;

    glowMat.color.set(poolHex);
    glowMat.opacity = Math.min(0.9, poolAmt * 0.42);
    glow.scale.setScalar(0.45 + poolW * 2.6);
    glow.visible = poolAmt > 0.008;

    material.color.set(cfg.metalColor || "#e6ebf0");
    material.metalness = num(cfg.metalness, 94) / 100;
    material.roughness = num(cfg.roughness, 26) / 100;
    material.envMapIntensity = num(cfg.envMapIntensity, 155) / 100;
    material.emissive.set(poolHex);
    material.emissiveIntensity = poolAmt * 0.22 + keyAmt * 0.06;
    material.needsUpdate = true;

    renderer.toneMappingExposure = num(cfg.exposure, 1.38);
    camera.position.z = 36 / Math.max(0.4, num(cfg.zoom, 1));
    camera.updateProjectionMatrix();
  }

  function applyConfig(partial = {}) {
    Object.assign(cfg, partial);
    applyLights(1);
    inner.rotation.set(
      THREE.MathUtils.degToRad(num(cfg.pitch, 3)),
      THREE.MathUtils.degToRad(num(cfg.yaw, 9)),
      0,
    );
    renderer.render(scene, camera);
  }

  applyLights(1);

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
    inner.scale.set(
      BASE_XY * (cfg.breathe ? pose.scaleX : 1),
      BASE_XY * (cfg.breathe ? pose.scaleY : 1),
      BASE_Z * (cfg.breathe ? pose.scaleZ : 1),
    );
    outer.position.y = 8 + (cfg.breathe ? pose.posY * 0.45 : 0);
    inner.rotation.set(
      THREE.MathUtils.degToRad(cfg.pitch),
      THREE.MathUtils.degToRad(cfg.yaw) + (cfg.breathe ? pose.rotY : 0),
      0,
    );
    const pulse = speaking ? 1.12 + pose.glow * 0.08 : 1 + pose.glow * 0.05;
    const livePulse = cfg.breathe ? pulse : 1;
    applyLights(livePulse);
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
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  resize();
  renderer.render(scene, camera);

  return {
    start,
    stop,
    setSpeaking(value) {
      speaking = Boolean(value);
    },
    applyConfig,
    getConfig() {
      return { ...cfg };
    },
    getLightState() {
      return {
        key: key.intensity,
        pool: pool.intensity,
        fill: fill.intensity,
        ambient: ambient.intensity,
        glow: glowMat.opacity,
        emissive: material.emissiveIntensity,
        yaw: num(cfg.yaw, 9),
        zoom: num(cfg.zoom, 1),
        exposure: renderer.toneMappingExposure,
      };
    },
    resize,
  };
}
