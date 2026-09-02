import * as THREE from "three";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";

const FONT_URL = new URL("../assets/mascot/bold.blob", import.meta.url).href;

/** Soft ice-cyan annulus that follows the 0's inner + outer contour — not a blob. */
function makeHaloTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const r = Math.hypot(dx / 0.7, dy / 0.92);
      const outer = Math.exp(-(((r - 0.82) / 0.09) ** 2));
      const inner = Math.exp(-(((r - 0.38) / 0.075) ** 2));
      const a = Math.max(outer, inner) * 0.42;
      const i = (y * size + x) * 4;
      img.data[i] = 160;
      img.data[i + 1] = 216;
      img.data[i + 2] = 239;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeRimMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: new THREE.Color("#a0d8ef") },
      pulse: { value: 0.7 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float pulse;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float ndv = 1.0 - abs(dot(n, v));
        float edge = pow(ndv, 5.2);
        float air = pow(ndv, 2.6);
        float core = pow(ndv, 9.0);
        float w = (core * 0.7 + edge * 0.38 + air * 0.08) * pulse;
        gl_FragColor = vec4(color * w, clamp(w, 0.0, 1.0));
      }
    `,
  });
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
    rotY: Math.sin(elapsed * 0.42) * 0.05,
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

  const scene = new THREE.Scene();
  scene.background = null;
  // Exact native /demo2 mobile mascot: fov 82 at z=36, group y=8, scale 0.82.
  const camera = new THREE.PerspectiveCamera(82, 1, 0.1, 200);
  camera.position.set(0, 0, 36);

  const cube = new THREE.CubeTexture(buildStudioFaces());
  cube.needsUpdate = true;
  cube.colorSpace = THREE.SRGBColorSpace;
  scene.environment = cube;

  scene.add(new THREE.AmbientLight(0xffffff, 0.38));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.55);
  key.position.set(0, 18, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb8d8ef, 0.28);
  rim.position.set(-8, 4, 12);
  scene.add(rim);
  const haloLight = new THREE.PointLight(0xa0d8ef, 0.35, 48, 2);
  haloLight.position.set(0, 2.2, 8);
  scene.add(haloLight);

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
    new THREE.PlaneGeometry(12.4, 5.4),
    new THREE.MeshStandardMaterial({
      map: makePlateTexture(),
      metalness: 0.72,
      roughness: 0.38,
    }),
  );
  plate.position.set(15.6, -13.6, 24);

  const glowMap = makeHaloTexture();
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.42,
      color: new THREE.Color("#a0d8ef"),
    }),
  );
  glow.scale.set(22, 28, 1);
  glow.position.set(0, 0, -2.4);

  const glowSoft = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.14,
      color: new THREE.Color("#7ec8e8"),
    }),
  );
  glowSoft.scale.set(28, 36, 1);
  glowSoft.position.set(0, 0, -3.2);

  const rimMat = makeRimMaterial();
  const rimEdge = new THREE.Mesh(geometry, rimMat);
  rimEdge.scale.setScalar(1.004);
  rimEdge.renderOrder = 2;

  // Native /demo2: inner scale 0.5 * mascotScale 0.82 ≈ 0.41, z-scale 0.1.
  const BASE_XY = 0.5;
  const BASE_Z = 0.1;
  const inner = new THREE.Group();
  inner.add(rimEdge);
  inner.add(mesh);
  inner.add(plate);
  inner.scale.set(BASE_XY, BASE_XY, BASE_Z);
  inner.rotation.set(-0.05, 0.16, 0.02);

  const outer = new THREE.Group();
  outer.add(glowSoft);
  outer.add(glow);
  outer.add(inner);
  outer.position.set(0, 8, 0);
  outer.scale.setScalar(0.82);
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
    inner.rotation.y = 0.16 + pose.rotY;
    const pulse = speaking ? 0.58 + pose.glow * 0.08 : 0.52 + pose.glow * 0.06;
    rimMat.uniforms.pulse.value = pulse;
    glow.material.opacity = 0.34 + pose.glow * 0.06;
    glowSoft.material.opacity = 0.12 + pose.glow * 0.04;
    glow.scale.set(22, 28, 1);
    glowSoft.scale.set(28, 36, 1);
    haloLight.intensity = 0.28 + pose.glow * 0.06;
    rim.intensity = 0.24;
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
