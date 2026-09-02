import { createReceptionMascot, LAB_STUDIO_CONFIG } from "./mascot.js?v=29";

const $ = (id) => document.getElementById(id);

let mascot = null;
let pending = null;

function readForm() {
  return {
    keyColor: $("keyColor").value,
    keySweep: Number($("keySweep").value),
    keyIntensity: Number($("keyIntensity").value),
    poolColor: $("poolColor").value,
    poolWidth: Number($("poolWidth").value),
    poolIntensity: Number($("poolIntensity").value),
    yaw: Number($("yaw").value),
    pitch: Number($("pitch").value),
    zoom: Number($("zoom").value) / 100,
    metalColor: $("metalColor").value,
    metalness: Number($("metalness").value),
    roughness: Number($("roughness").value),
    envMapIntensity: Number($("envMapIntensity").value),
    fillIntensity: Number($("fillIntensity").value),
    ambientIntensity: Number($("ambientIntensity").value),
    exposure: Number($("exposure").value) / 100,
    breathe: $("breathe").checked,
  };
}

function writeOutputs(cfg) {
  $("keySweepOut").textContent = `${cfg.keySweep}°`;
  $("keyIntensityOut").textContent = `${cfg.keyIntensity}%`;
  $("poolWidthOut").textContent = `${cfg.poolWidth}%`;
  $("poolIntensityOut").textContent = `${cfg.poolIntensity}%`;
  $("yawOut").textContent = `${cfg.yaw}°`;
  $("pitchOut").textContent = `${cfg.pitch}°`;
  $("zoomOut").textContent = `${cfg.zoom.toFixed(2)}×`;
  $("metalnessOut").textContent = `${cfg.metalness}%`;
  $("roughnessOut").textContent = `${cfg.roughness}%`;
  $("envMapIntensityOut").textContent = `${cfg.envMapIntensity}%`;
  $("fillIntensityOut").textContent = `${cfg.fillIntensity}%`;
  $("ambientIntensityOut").textContent = `${cfg.ambientIntensity}%`;
  $("exposureOut").textContent = cfg.exposure.toFixed(2);
  $("json").textContent = JSON.stringify(cfg, null, 2);
}

function setStatus(text) {
  const el = $("lab-status");
  if (el) el.textContent = text;
}

function apply() {
  const cfg = readForm();
  writeOutputs(cfg);
  if (!mascot) {
    pending = cfg;
    return;
  }
  try {
    mascot.applyConfig(cfg);
    const lights = mascot.getLightState?.();
    if (lights) {
      setStatus(
        `Live — key ${lights.key.toFixed(2)} · pool ${lights.pool.toFixed(1)} · glow ${lights.glow.toFixed(2)} · yaw ${cfg.yaw}°`,
      );
    }
  } catch (err) {
    setStatus(`Apply failed: ${err?.message || err}`);
    console.error(err);
  }
}

function syncForm(cfg) {
  $("keyColor").value = cfg.keyColor;
  $("keySweep").value = cfg.keySweep;
  $("keyIntensity").value = cfg.keyIntensity;
  $("poolColor").value = cfg.poolColor;
  $("poolWidth").value = cfg.poolWidth;
  $("poolIntensity").value = cfg.poolIntensity;
  $("yaw").value = cfg.yaw;
  $("pitch").value = cfg.pitch;
  $("zoom").value = Math.round(cfg.zoom * 100);
  $("metalColor").value = cfg.metalColor;
  $("metalness").value = cfg.metalness;
  $("roughness").value = cfg.roughness;
  $("envMapIntensity").value = cfg.envMapIntensity;
  $("fillIntensity").value = cfg.fillIntensity;
  $("ambientIntensity").value = cfg.ambientIntensity;
  $("exposure").value = Math.round(cfg.exposure * 100);
  $("breathe").checked = cfg.breathe;
  writeOutputs(cfg);
}

const panel = document.querySelector(".lab-panel");
panel.addEventListener("input", apply);
panel.addEventListener("change", apply);
panel.addEventListener("pointerup", apply);

$("backdrop").addEventListener("change", () => {
  const phone = document.querySelector(".lab-phone");
  phone.dataset.bg = $("backdrop").value;
  $("lab-black").hidden = $("backdrop").value !== "black";
});

$("reset").addEventListener("click", () => {
  if (!mascot) return;
  mascot.applyConfig(LAB_STUDIO_CONFIG);
  syncForm(mascot.getConfig());
  apply();
});

$("copy").addEventListener("click", async () => {
  const text = JSON.stringify(mascot ? mascot.getConfig() : readForm(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("copy").textContent = "Copied";
    window.setTimeout(() => {
      $("copy").textContent = "Copy config";
    }, 1200);
  } catch {
    $("json").focus();
  }
});

setStatus("Loading steel…");
try {
  mascot = await createReceptionMascot($("lab-mascot"), LAB_STUDIO_CONFIG);
  mascot.start();
  mascot.resize();
  window.__pzLabMascot = mascot;
  syncForm(pending || mascot.getConfig());
  apply();
} catch (err) {
  setStatus(`Mascot failed: ${err?.message || err}`);
  console.error(err);
}
