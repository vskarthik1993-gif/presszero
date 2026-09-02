import { createReceptionMascot, DEFAULT_MASCOT_CONFIG } from "./mascot.js?v=28";

const $ = (id) => document.getElementById(id);

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

const mascot = await createReceptionMascot($("lab-mascot"), DEFAULT_MASCOT_CONFIG);
mascot.start();
syncForm(mascot.getConfig());

function apply() {
  const cfg = readForm();
  mascot.applyConfig(cfg);
  writeOutputs(cfg);
}

for (const el of document.querySelectorAll("input, select")) {
  el.addEventListener("input", apply);
  el.addEventListener("change", apply);
}

$("backdrop").addEventListener("change", () => {
  const phone = document.querySelector(".lab-phone");
  phone.dataset.bg = $("backdrop").value;
  $("lab-black").hidden = $("backdrop").value !== "black";
});

$("reset").addEventListener("click", () => {
  mascot.applyConfig(DEFAULT_MASCOT_CONFIG);
  syncForm(mascot.getConfig());
});

$("copy").addEventListener("click", async () => {
  const text = JSON.stringify(mascot.getConfig(), null, 2);
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
