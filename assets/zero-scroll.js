import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const PRESETS = {
  void: {
    label: "Void",
    color: 0x14141a,
    metalness: 0.15,
    roughness: 0.12,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.65,
    key: 0xfda949,
    keyIntensity: 1.15,
  },
  amber: {
    label: "Bronze",
    color: 0xc88448,
    metalness: 0.98,
    roughness: 0.18,
    clearcoat: 0.35,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.05,
    key: 0xfda949,
    keyIntensity: 2.35,
  },
  gold: {
    label: "Gold",
    color: 0xf0e6d8,
    metalness: 0.04,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.2,
    key: 0xeda45c,
    rim: 0xffd981,
    keyIntensity: 2.1,
  },
  liquid: {
    label: "Liquid",
    color: 0xe8ecf2,
    metalness: 1,
    roughness: 0.04,
    clearcoat: 0.25,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.45,
    key: 0xfda949,
    keyIntensity: 1.05,
  },
};

const SECTION_IDS = ["top", "week", "dashboard", "platform", "languages", "pricing", "contact"];
const DESKTOP_POSES = [
  { x: 0, y: -0.27, z: 0.18, rx: -0.08, ry: 0.28, rz: -0.03, s: 1.05 },
  { x: -1.35, y: 0.05, z: -0.20, rx: 0.16, ry: 1.12, rz: 0.10, s: 1.18 },
  { x: 0.80, y: -0.08, z: 0.10, rx: -0.12, ry: 2.20, rz: -0.08, s: 1.24 },
  { x: -1.20, y: 0.08, z: -0.15, rx: 0.18, ry: 3.32, rz: 0.08, s: 1.12 },
  { x: 1.28, y: 0.02, z: 0.04, rx: -0.08, ry: 4.38, rz: -0.10, s: 1.20 },
  { x: -0.85, y: -0.04, z: -0.10, rx: 0.13, ry: 5.35, rz: 0.07, s: 1.08 },
  { x: 0.42, y: 0.02, z: 0.12, rx: -0.08, ry: Math.PI * 2, rz: 0, s: 1.22 },
];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const mobileViewport = window.matchMedia("(max-width: 700px)");
let canvas;
let renderer;
let scene;
let camera;
let zero;
let material;
let keyLight;
let rimLight;
let frameId = 0;
let running = false;
let anchorStops = [];
let smoothedScroll = window.scrollY;
let activePreset = "amber";
let floatStartedAt = null;

function selectedPreset() {
  const candidate = new URLSearchParams(location.search).get("zero");
  return Object.prototype.hasOwnProperty.call(PRESETS, candidate) ? candidate : "amber";
}

function smoothstep(t) {
  const value = Math.max(0, Math.min(1, t));
  return value * value * (3 - 2 * value);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makeEnvironmentFace(index) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const angles = [
    [0, 256, 256, 0],
    [256, 0, 0, 256],
    [128, 256, 128, 0],
    [128, 0, 128, 256],
    [0, 128, 256, 128],
    [256, 128, 0, 128],
  ];
  const [x0, y0, x1, y1] = angles[index];
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, "#050201");
  gradient.addColorStop(0.26, "#1a0902");
  gradient.addColorStop(0.52, "#7a3510");
  gradient.addColorStop(0.68, "#d8873e");
  gradient.addColorStop(0.78, "#ffe1a0");
  gradient.addColorStop(0.9, "#5b2108");
  gradient.addColorStop(1, "#070301");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const bloom = context.createRadialGradient(
    index % 2 ? 72 : 184,
    index < 2 ? 74 : 170,
    6,
    128,
    128,
    186,
  );
  bloom.addColorStop(0, "rgba(255,225,170,.42)");
  bloom.addColorStop(0.36, "rgba(240,145,55,.16)");
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = bloom;
  context.fillRect(0, 0, 256, 256);
  return canvas;
}

function makeSmoothEnvironment(renderer) {
  const cube = new THREE.CubeTexture(
    Array.from({ length: 6 }, (_, index) => makeEnvironmentFace(index)),
  );
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromCubemap(cube).texture;
  pmrem.dispose();
  cube.dispose();
  return environment;
}

function poseFor(index) {
  const pose = DESKTOP_POSES[index];
  if (!mobileViewport.matches) return pose;
  return {
    ...pose,
    x: pose.x * 0.54,
    y: pose.y * 0.65,
    z: pose.z - 0.12,
    s: pose.s * 0.78,
  };
}

function updateAnchors() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  anchorStops = SECTION_IDS.map((id) => {
    const section = document.getElementById(id);
    if (!section) return 0;
    return Math.max(0, Math.min(maxScroll, section.offsetTop - innerHeight * 0.28));
  });
}

function applyPreset(name, updateUrl = false) {
  if (!PRESETS[name]) return false;
  activePreset = name;
  const preset = PRESETS[name];
  if (material) {
    material.color.setHex(preset.color);
    material.metalness = preset.metalness;
    material.roughness = preset.roughness;
    material.clearcoat = preset.clearcoat;
    material.clearcoatRoughness = preset.clearcoatRoughness;
    material.envMapIntensity = preset.envMapIntensity;
    material.needsUpdate = true;
  }
  if (keyLight) {
    keyLight.color.setHex(preset.key);
    keyLight.intensity = preset.keyIntensity;
  }
  if (rimLight) {
    rimLight.color.setHex(preset.rim || preset.key);
    rimLight.intensity = name === "gold" ? 1.6 : 1.05;
  }
  document.documentElement.dataset.zeroPreset = name;
  document.querySelectorAll("[data-zero-preset]").forEach((button) => {
    const selected = button.dataset.zeroPreset === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("zero", name);
    history.replaceState(null, "", url);
  }
  if (reducedMotion.matches && renderer && scene && camera) renderer.render(scene, camera);
  return true;
}

function buildLab() {
  if (new URLSearchParams(location.search).get("zeroLab") !== "1") return;
  const lab = document.createElement("aside");
  lab.className = "zero-lab";
  lab.setAttribute("aria-label", "Zero finish lab");
  lab.innerHTML = `<span>Zero finish</span>${Object.entries(PRESETS)
    .map(([name, preset]) => `<button type="button" data-zero-preset="${name}">${preset.label}</button>`)
    .join("")}`;
  lab.addEventListener("click", (event) => {
    const button = event.target.closest("[data-zero-preset]");
    if (button) applyPreset(button.dataset.zeroPreset, true);
  });
  document.body.appendChild(lab);
}

function applyScrollPose(time) {
  if (!zero) return;
  if (reducedMotion.matches) {
    canvas.style.setProperty("--zero-hero-lift", mobileViewport.matches ? "88px" : "6px");
    const pose = poseFor(0);
    zero.position.set(pose.x * 0.65, pose.y, pose.z);
    zero.rotation.set(pose.rx, 0.42, pose.rz);
    zero.scale.setScalar(pose.s * 0.92);
    return;
  }

  smoothedScroll += (window.scrollY - smoothedScroll) * 0.06;
  let segment = 0;
  while (segment < anchorStops.length - 2 && smoothedScroll >= anchorStops[segment + 1]) segment += 1;
  const start = anchorStops[segment] ?? 0;
  const end = anchorStops[segment + 1] ?? start + 1;
  const t = smoothstep((smoothedScroll - start) / Math.max(1, end - start));
  canvas.style.setProperty(
    "--zero-hero-lift",
    segment === 0 ? (mobileViewport.matches ? "88px" : "6px") : "0px",
  );
  const a = poseFor(segment);
  const b = poseFor(Math.min(segment + 1, DESKTOP_POSES.length - 1));
  if (floatStartedAt === null) floatStartedAt = time;
  const floatPhase = ((time - floatStartedAt) % 6667) / 6667;
  const floatProgress = 0.5 - 0.5 * Math.cos(floatPhase * Math.PI * 2);
  const modelZ = lerp(a.z, b.z, t);
  const cameraDistance = Math.abs(camera.position.z - modelZ);
  const visibleWorldHeight =
    2 * cameraDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  const floatOffset = visibleWorldHeight * 0.025 * floatProgress;

  zero.position.set(
    lerp(a.x, b.x, t),
    lerp(a.y, b.y, t) + floatOffset,
    modelZ,
  );
  zero.rotation.set(
    lerp(a.rx, b.rx, t),
    lerp(a.ry, b.ry, t) + Math.sin(time * 0.00018) * 0.025,
    lerp(a.rz, b.rz, t),
  );
  zero.scale.setScalar(lerp(a.s, b.s, t));
}

function render(time = 0) {
  if (!running) return;
  applyScrollPose(time);
  renderer.render(scene, camera);
  if (!reducedMotion.matches) frameId = requestAnimationFrame(render);
}

function startRendering() {
  if (running || document.hidden || !renderer) return;
  running = true;
  frameId = requestAnimationFrame(render);
}

function stopRendering() {
  running = false;
  cancelAnimationFrame(frameId);
}

function resize() {
  if (!renderer || !camera) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobileViewport.matches ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  updateAnchors();
  if (reducedMotion.matches) {
    applyScrollPose(0);
    renderer.render(scene, camera);
  }
}

function failQuietly() {
  stopRendering();
  if (canvas) canvas.remove();
  document.documentElement.classList.remove("zero-ready");
}

async function init() {
  activePreset = selectedPreset();
  buildLab();
  canvas = document.createElement("canvas");
  canvas.id = "zero-scroll-canvas";
  canvas.className = "zero-scroll-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !mobileViewport.matches,
      powerPreference: "high-performance",
    });
  } catch {
    failQuietly();
    return;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 30);
  camera.position.set(0, 0, 5.6);

  scene.environment = makeSmoothEnvironment(renderer);

  scene.add(new THREE.HemisphereLight(0xffe4be, 0x160900, 0.8));
  keyLight = new THREE.DirectionalLight(0xfda949, 2.35);
  keyLight.position.set(3.8, 3.2, 4.5);
  scene.add(keyLight);
  rimLight = new THREE.DirectionalLight(0xfda949, 1.05);
  rimLight.position.set(-4, 1.2, -2.8);
  scene.add(rimLight);

  applyPreset(activePreset);

  try {
    const fontUrl = new URL("../mascot/assets/mascot/zero-mascot.typeface.json", import.meta.url);
    const font = await new FontLoader().loadAsync(fontUrl.href);
    const rawGeometry = new TextGeometry("0", {
      font,
      size: 2.25,
      depth: 0.38,
      curveSegments: mobileViewport.matches ? 36 : 64,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.06,
      bevelSegments: mobileViewport.matches ? 8 : 14,
    });
    rawGeometry.deleteAttribute("uv");
    const geometry = mergeVertices(rawGeometry, 0.0001);
    rawGeometry.dispose();
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.center();
    material = new THREE.MeshPhysicalMaterial({ flatShading: false });
    zero = new THREE.Mesh(geometry, material);
    zero.rotation.order = "XYZ";
    scene.add(zero);
    applyPreset(activePreset);
    resize();
    applyScrollPose(0);
    document.documentElement.classList.add("zero-ready");
    renderer.render(scene, camera);
    if (!reducedMotion.matches) startRendering();
  } catch {
    failQuietly();
  }
}

window.PressZeroZero = {
  setPreset(name) {
    return applyPreset(String(name || "").toLowerCase(), true);
  },
  getPreset() {
    return activePreset;
  },
};

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("load", updateAnchors, { once: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopRendering();
  else if (!reducedMotion.matches) startRendering();
  else if (renderer) render(0);
});
reducedMotion.addEventListener?.("change", () => {
  stopRendering();
  if (reducedMotion.matches && renderer) {
    running = true;
    render(0);
    running = false;
  } else {
    startRendering();
  }
});
mobileViewport.addEventListener?.("change", resize);

init().catch(failQuietly);
