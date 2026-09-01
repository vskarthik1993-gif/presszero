import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const FONT_URL = new URL("../assets/mascot/bold.blob", import.meta.url).href;

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, "rgba(210, 236, 255, 0.55)");
  g.addColorStop(0.28, "rgba(140, 196, 232, 0.22)");
  g.addColorStop(0.62, "rgba(80, 150, 200, 0.08)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
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

function buildStudioFaces() {
  const faces = [];
  for (let i = 0; i < 6; i += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const isTop = i === 2;
    const isBottom = i === 3;
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    if (isTop) {
      grad.addColorStop(0, "#fff8f0");
      grad.addColorStop(1, "#c8ccd4");
    } else if (isBottom) {
      grad.addColorStop(0, "#3a3a42");
      grad.addColorStop(1, "#0e1014");
    } else {
      grad.addColorStop(0, "#f5e8d8");
      grad.addColorStop(0.35, "#a0a4ae");
      grad.addColorStop(1, "#1a1a20");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    if (!isTop && !isBottom) {
      ctx.fillStyle = "rgba(255, 240, 220, 0.35)";
      ctx.fillRect(48, 0, 32, 48);
    }
    faces.push(canvas);
  }
  return faces;
}

const pbrSurfaceShader = {
  uniforms: {
    baseColor: { value: new THREE.Color("#ddd8d0") },
    lightColor: { value: new THREE.Color("#f5e6d4") },
    lightDir: { value: new THREE.Vector3(0, -1, 0.12).normalize() },
    lightIntensity: { value: 1.05 },
    metalness: { value: 0 },
    roughness: { value: 0.94 },
    clearcoat: { value: 0.08 },
    clearcoatRoughness: { value: 0.32 },
    envMap: { value: null },
    envMapIntensity: { value: 0.18 },
    flipEnvMap: { value: -1 },
    keyLightDir: { value: new THREE.Vector3(0, -1, 0.2).normalize() },
    keyLightColor: { value: new THREE.Color("#ffe8d0") },
    keyLightIntensity: { value: 0.42 },
  },
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vPos;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      vPos = position;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 baseColor;
    uniform vec3 lightColor;
    uniform vec3 lightDir;
    uniform float lightIntensity;
    uniform float metalness;
    uniform float roughness;
    uniform float clearcoat;
    uniform float clearcoatRoughness;
    uniform samplerCube envMap;
    uniform float envMapIntensity;
    uniform float flipEnvMap;
    uniform vec3 keyLightDir;
    uniform vec3 keyLightColor;
    uniform float keyLightIntensity;
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vPos;

    void main() {
      vec3 n = normalize(vNormal);
      vec3 v = normalize(vView);
      vec3 l = normalize(-lightDir);
      float topLit = pow(max(dot(n, l), 0.0), 0.72);
      float poolMix = lightIntensity;
      float litMix = clamp(poolMix + keyLightIntensity, 0.0, 1.0);
      float ambient = mix(0.10, 0.28, step(0.02, litMix));
      float shade = ambient + topLit * poolMix * 0.78;
      float r = clamp(roughness, 0.02, 0.98);
      vec3 h = normalize(l + v);
      float specPow = mix(6.0, 128.0, 1.0 - r);
      float spec = pow(max(dot(n, h), 0.0), specPow) * topLit * poolMix;
      vec3 refl = reflect(-v, n);
      vec3 env = textureCube(envMap, vec3(flipEnvMap * refl.x, refl.y, refl.z)).rgb;
      float envGate = pow(topLit, 0.48) * litMix;
      vec3 diffuse = baseColor * shade * (0.5 + 0.5 * (1.0 - metalness * 0.8));
      vec3 specCol = mix(vec3(0.04), lightColor, metalness);
      vec3 col = diffuse + specCol * spec * (0.3 + metalness * 0.9);
      col = mix(col, env * envMapIntensity, metalness * (1.0 - r * 0.6) * envGate);
      col += env * envMapIntensity * 0.08 * (1.0 - metalness) * envGate;
      col += lightColor * topLit * poolMix * 0.22;
      if (clearcoat > 0.01) {
        float ccSpec = pow(max(dot(n, h), 0.0), mix(20.0, 200.0, 1.0 - clearcoatRoughness)) * topLit * poolMix;
        col += vec3(1.0) * ccSpec * clearcoat * 0.55;
      }
      if (keyLightIntensity > 0.001) {
        vec3 kl = normalize(-keyLightDir);
        float keyLit = pow(max(dot(n, kl), 0.0), 0.58);
        col += baseColor * keyLit * keyLightIntensity * 0.18;
        col += keyLightColor * keyLit * keyLightIntensity * 0.28;
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

function sampleBreathe(elapsed, speaking) {
  const s = Math.sin(elapsed * 2.0);
  const lift = speaking ? 0.22 : 0.16;
  const squash = speaking ? 0.06 : 0.045;
  return {
    posY: s * lift,
    scaleY: 1 + s * squash,
    scaleX: 1 - s * (squash * 0.5),
    scaleZ: 1 - s * 0.015,
    rotY: Math.sin(elapsed * 0.5) * 0.04,
  };
}

export async function createReceptionMascot(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  camera.position.set(0, 0.15, 28);

  const cube = new THREE.CubeTexture(buildStudioFaces());
  cube.needsUpdate = true;
  cube.colorSpace = THREE.SRGBColorSpace;
  scene.environment = cube;

  scene.add(new THREE.AmbientLight(0xffffff, 0.38));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.55);
  key.position.set(0, 18, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ed4ff, 0.85);
  rim.position.set(-8, 4, 12);
  scene.add(rim);
  const haloLight = new THREE.PointLight(0xb8e0ff, 1.1, 40, 2);
  haloLight.position.set(0, 2.2, 6);
  scene.add(haloLight);

  const font = await new FontLoader().loadAsync(FONT_URL);
  const geometry = new TextGeometry("0", {
    font,
    size: 40,
    depth: 18,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: 1.05,
    bevelSize: 0.6,
    bevelSegments: 16,
  });
  geometry.computeBoundingBox();
  geometry.center();

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xddd8d0,
    metalness: 0.04,
    roughness: 0.9,
    clearcoat: 0.12,
    clearcoatRoughness: 0.34,
    envMap: cube,
    envMapIntensity: 0.22,
    sheen: 0.18,
    sheenColor: new THREE.Color("#f2ece4"),
  });
  const mesh = new THREE.Mesh(geometry, material);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(9.6, 4.15),
    new THREE.MeshStandardMaterial({
      map: makePlateTexture(),
      metalness: 0.72,
      roughness: 0.38,
    }),
  );
  plate.position.set(11.2, -14.6, 10.2);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
    }),
  );
  glow.scale.set(78, 90, 1);
  glow.position.set(0, 0, -6);

  const inner = new THREE.Group();
  inner.add(mesh);
  inner.add(plate);
  inner.scale.set(0.42, 0.42, 0.085);
  inner.rotation.set(-0.06, 0.18, 0.02);

  const outer = new THREE.Group();
  outer.add(glow);
  outer.add(inner);
  outer.position.set(0, 0.55, 0);
  scene.add(outer);

  let speaking = false;
  let running = false;
  let frameId = 0;
  let startedAt = 0;

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function render(stamp) {
    if (!running) return;
    if (!startedAt) startedAt = stamp;
    const elapsed = (stamp - startedAt) / 1000;
    const pose = sampleBreathe(elapsed, speaking);
    outer.position.y = 0.55 + pose.posY;
    inner.scale.set(0.42 * pose.scaleX, 0.42 * pose.scaleY, 0.085 * pose.scaleZ);
    inner.rotation.y = 0.18 + pose.rotY;
    glow.material.opacity = speaking ? 1 : 0.82;
    glow.scale.set(speaking ? 86 : 78, speaking ? 98 : 90, 1);
    haloLight.intensity = speaking ? 1.55 : 1.05;
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
