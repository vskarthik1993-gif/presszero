(() => {
  const ASSETS = ["Tilted V1", "Tilted V2", "Non-Tilted"];
  const MOTION_IDS = new Set(["shine-dark", "shine-light"]);
  const COLOR_EMBER = { gold: "#F8300D", sat: 1.2, bright: 1.25 };
  const COLOR_ORIGINAL = { gold: "#E8892E", sat: 1, bright: 1 };
  const PRESETS = {
    ember: {
      id: "ember",
      label: "Ember V1",
      logoAsset: "Tilted V1",
      colorsByAsset: {
        "Tilted V1": { ...COLOR_EMBER },
        "Tilted V2": { ...COLOR_EMBER },
        "Non-Tilted": { ...COLOR_EMBER }
      },
      obsidian: "#0B0B0D",
      paper: "#F5F3EF"
    },
    original: {
      id: "original",
      label: "Original Gold",
      logoAsset: "Tilted V1",
      colorsByAsset: {
        "Tilted V1": { ...COLOR_ORIGINAL },
        "Tilted V2": { ...COLOR_ORIGINAL },
        "Non-Tilted": { ...COLOR_ORIGINAL }
      },
      obsidian: "#0B0B0D",
      paper: "#F5F3EF"
    }
  };
  const COLOR_DEFAULT = { ...COLOR_EMBER };
  const DEFAULT_STATE = {
    preset: "ember",
    logoAsset: "Tilted V1",
    colorsByAsset: {
      "Tilted V1": { ...COLOR_EMBER },
      "Tilted V2": { ...COLOR_EMBER },
      "Non-Tilted": { ...COLOR_EMBER }
    },
    obsidian: "#0B0B0D",
    paper: "#F5F3EF"
  };
  const QUALITY_PRESETS = {
    standard: { label: "Standard", scale: 2, longEdge: 0 },
    high: { label: "High", scale: 3, longEdge: 2048 },
    ultra: { label: "Ultra", scale: 2, longEdge: 4096 },
    max: { label: "Max", scale: 2, longEdge: 8192 }
  };

  const STORAGE_KEY = "presszero-tweaks-v2";
  let state = loadState();
  let history = [clone(state)];
  let historyIndex = 0;
  let selectedEl = null;
  let selectedMeta = null;
  let gleamPreviewRaf = 0;
  let gleamPreviewOnScroll = null;
  let selectMode = true;
  let suppressHistory = false;
  let estimateTimer = null;
  let hoverEl = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return {
        ...clone(DEFAULT_STATE),
        ...parsed,
        colorsByAsset: {
          ...clone(DEFAULT_STATE.colorsByAsset),
          ...(parsed.colorsByAsset || {})
        }
      };
    } catch {
      return clone(DEFAULT_STATE);
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function activeColors() {
    return state.colorsByAsset[state.logoAsset] || { ...COLOR_DEFAULT };
  }

  function pushHistory() {
    if (suppressHistory) return;
    history = history.slice(0, historyIndex + 1);
    history.push(clone(state));
    historyIndex = history.length - 1;
    if (history.length > 80) {
      history.shift();
      historyIndex -= 1;
    }
    updateHistoryButtons();
  }

  function applyToRuntime(next = state) {
    persist();
    const colors = next.colorsByAsset[next.logoAsset] || COLOR_DEFAULT;
    const url = new URL(window.location.href);
    url.searchParams.set("logoAsset", next.logoAsset);
    url.searchParams.set("gold", colors.gold);
    url.searchParams.set("sat", String(colors.sat));
    url.searchParams.set("bright", String(colors.bright));
    window.history.replaceState({}, "", url);
    const rootName = typeof window.__dcRootName === "function" ? window.__dcRootName() : null;
    if (rootName && typeof window.__dcSetProps === "function") {
      window.__dcSetProps(rootName, {
        logoAsset: next.logoAsset,
        gold: colors.gold,
        sat: Number(colors.sat),
        bright: Number(colors.bright),
        obsidian: next.obsidian,
        paper: next.paper
      });
    }
    // Refresh live gleam after CSS vars update.
    requestAnimationFrame(() => updateGleamPreview());
  }

  function setState(patch, { record = true } = {}) {
    state = {
      ...state,
      ...patch,
      colorsByAsset: patch.colorsByAsset
        ? { ...state.colorsByAsset, ...patch.colorsByAsset }
        : state.colorsByAsset
    };
    if (record) pushHistory();
    applyToRuntime(state);
    syncForm();
  }

  function updateAssetColor(partial, { record = true } = {}) {
    const asset = state.logoAsset;
    setState(
      {
        preset: "custom",
        colorsByAsset: {
          ...state.colorsByAsset,
          [asset]: { ...activeColors(), ...partial }
        }
      },
      { record }
    );
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    suppressHistory = true;
    state = clone(history[historyIndex]);
    applyToRuntime(state);
    syncForm();
    suppressHistory = false;
    updateHistoryButtons();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    suppressHistory = true;
    state = clone(history[historyIndex]);
    applyToRuntime(state);
    syncForm();
    suppressHistory = false;
    updateHistoryButtons();
  }

  function resetDefaults() {
    setState(clone(DEFAULT_STATE));
  }

  function applyPreset(presetId) {
    const preset = PRESETS[presetId];
    if (!preset) return;
    setState({
      preset: preset.id,
      logoAsset: preset.logoAsset,
      colorsByAsset: clone(preset.colorsByAsset),
      obsidian: preset.obsidian,
      paper: preset.paper
    });
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "checked") node.checked = !!value;
      else if (value != null && value !== false) node.setAttribute(key, value === true ? "" : value);
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child == null || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function isUiChrome(node) {
    return !!(node && node.closest && node.closest("#pz-local-controls, #pz-reopen, #pz-hover-box"));
  }

  function cssPath(node) {
    if (!(node instanceof Element)) return "";
    if (node.hasAttribute("data-export-id")) {
      return `[data-export-id="${node.getAttribute("data-export-id")}"]`;
    }
    if (node.id && !String(node.id).startsWith("pz-")) {
      return `#${CSS.escape(node.id)}`;
    }
    const parts = [];
    let current = node;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      if (current.hasAttribute("data-export-id")) {
        parts.unshift(`[data-export-id="${current.getAttribute("data-export-id")}"]`);
        break;
      }
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      if (current === document.body) break;
      current = parent;
      if (parts.length > 14) break;
    }
    return parts.join(" > ");
  }

  function slugFor(node) {
    const exportId = node.getAttribute("data-export-id");
    if (exportId) return exportId;
    const tag = node.tagName.toLowerCase();
    const cls = (node.className && typeof node.className === "string"
      ? node.className.split(/\s+/).filter(Boolean)[0]
      : "") || "el";
    return `${tag}-${cls}`.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 48);
  }

  function describeNode(node) {
    const rect = node.getBoundingClientRect();
    const exportId = node.getAttribute("data-export-id");
    const imgs = [...node.querySelectorAll("img")].concat(node.tagName === "IMG" ? [node] : []);
    const svgs = [...node.querySelectorAll("svg")].concat(node.tagName === "SVG" ? [node] : []);
    const maxNatural = imgs.reduce(
      (max, img) => Math.max(max, img.naturalWidth || 0, img.naturalHeight || 0),
      0
    );
    const hasShine = !!node.querySelector("[style*='pz-shine'], [data-shine-mask]") ||
      MOTION_IDS.has(exportId || "");
    const logoLike = imgs.some((img) => /logo-ring/i.test(img.getAttribute("src") || img.currentSrc || ""));
    return {
      exportId,
      selector: cssPath(node),
      slug: slugFor(node),
      tag: node.tagName.toLowerCase(),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      imgCount: imgs.length,
      svgCount: svgs.length,
      maxNatural,
      motion: hasShine,
      logoLike
    };
  }

  function findLogoImg(node) {
    if (!node) return null;
    if (node.tagName === "IMG" && /logo-ring/i.test(node.getAttribute("src") || node.currentSrc || "")) {
      return node;
    }
    return [...node.querySelectorAll("img")].find((img) =>
      /logo-ring/i.test(img.getAttribute("src") || img.currentSrc || "")
    ) || null;
  }

  function clearGleamPreview() {
    if (gleamPreviewRaf) {
      cancelAnimationFrame(gleamPreviewRaf);
      gleamPreviewRaf = 0;
    }
    if (gleamPreviewOnScroll) {
      window.removeEventListener("scroll", gleamPreviewOnScroll, true);
      window.removeEventListener("resize", gleamPreviewOnScroll);
      gleamPreviewOnScroll = null;
    }
    document.getElementById("pz-gleam-preview")?.remove();
  }

  function positionGleamPreview() {
    const overlay = document.getElementById("pz-gleam-preview");
    const img = overlay?.__pzImg;
    if (!overlay || !img || !document.contains(img)) {
      clearGleamPreview();
      return;
    }
    const rect = img.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  function updateGleamPreview() {
    clearGleamPreview();
    const gleamOn = !!document.getElementById("pz-gleam")?.checked;
    if (!gleamOn || !selectedEl) return;

    const img = findLogoImg(selectedEl);
    if (!img) return;

    const guide =
      document.querySelector('[data-export-id="guide-root"]') ||
      document.querySelector("#dc-root") ||
      document.body;
    const gleamRgb =
      getComputedStyle(guide).getPropertyValue("--gleam-rgb").trim() || "255, 204, 214";
    const maskUrl = img.currentSrc || img.src;

    const overlay = document.createElement("div");
    overlay.id = "pz-gleam-preview";
    overlay.setAttribute("data-pz-live-gleam", "1");
    overlay.__pzImg = img;
    overlay.style.cssText = [
      "position:fixed",
      "z-index:2147482500",
      "pointer-events:none",
      "overflow:hidden",
      `-webkit-mask-image:url("${maskUrl}")`,
      "-webkit-mask-size:contain",
      "-webkit-mask-repeat:no-repeat",
      "-webkit-mask-position:center",
      `mask-image:url("${maskUrl}")`,
      "mask-size:contain",
      "mask-repeat:no-repeat",
      "mask-position:center"
    ].join(";");

    const band = document.createElement("div");
    band.style.cssText = [
      "position:absolute",
      "top:-30%",
      "left:0",
      "width:56%",
      "height:160%",
      `background:linear-gradient(90deg, rgba(${gleamRgb},0) 0%, rgba(${gleamRgb},0.9) 40%, rgba(255,236,240,0.9) 50%, rgba(${gleamRgb},0.9) 60%, rgba(${gleamRgb},0) 100%)`,
      "filter:blur(2px)",
      "animation:pz-shine 3.4s ease-in-out infinite",
      "will-change:transform"
    ].join(";");
    overlay.appendChild(band);
    document.body.appendChild(overlay);
    positionGleamPreview();

    gleamPreviewOnScroll = () => positionGleamPreview();
    window.addEventListener("scroll", gleamPreviewOnScroll, true);
    window.addEventListener("resize", gleamPreviewOnScroll);
    const tick = () => {
      positionGleamPreview();
      gleamPreviewRaf = requestAnimationFrame(tick);
    };
    gleamPreviewRaf = requestAnimationFrame(tick);
  }

  function stillFormats({ motion, transparent, gleam }) {
    // Browser export ships stills + GIF first; MP4 comes later.
    if (gleam || motion) return ["gif"];
    if (transparent) return ["png"];
    return ["png", "jpeg"];
  }

  function clearMarks() {
    document.querySelectorAll(".pz-selected-el").forEach((node) => node.classList.remove("pz-selected-el"));
    const box = document.getElementById("pz-hover-box");
    if (box) box.style.display = "none";
  }

  function placeHoverBox(node) {
    const box = document.getElementById("pz-hover-box");
    if (!box || !node) return;
    const rect = node.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = `${Math.max(0, rect.left)}px`;
    box.style.top = `${Math.max(0, rect.top)}px`;
    box.style.width = `${Math.max(0, rect.width)}px`;
    box.style.height = `${Math.max(0, rect.height)}px`;
  }

  function setSelected(node) {
    clearMarks();
    selectedEl = node || null;
    selectedMeta = node ? describeNode(node) : null;
    if (node) node.classList.add("pz-selected-el");

    const label = document.getElementById("pz-selected-label");
    const info = document.getElementById("pz-selected-info");
    if (!selectedMeta) {
      label.textContent = "None — click any element";
      info.textContent = "";
    } else {
      const idBit = selectedMeta.exportId ? ` · ${selectedMeta.exportId}` : "";
      label.textContent = `<${selectedMeta.tag}>${idBit} · ${selectedMeta.width}×${selectedMeta.height}px`;
      const bits = [];
      if (selectedMeta.imgCount) {
        bits.push(
          `${selectedMeta.imgCount} PNG/raster img` +
            (selectedMeta.maxNatural ? ` (source up to ${selectedMeta.maxNatural}px)` : "")
        );
      }
      if (selectedMeta.svgCount) bits.push(`${selectedMeta.svgCount} SVG`);
      if (!selectedMeta.imgCount && !selectedMeta.svgCount) bits.push("HTML/CSS only");
      bits.push("Logo mark assets are PNG, not SVG");
      info.textContent = bits.join(" · ");
    }

    const transparentRow = document.getElementById("pz-transparent-row");
    const transparent = document.getElementById("pz-transparent");
    // Mascot PNGs are already transparent — export as-is; no runtime bg strip / checkbox.
    const canTransparent = false;
    if (transparentRow) transparentRow.hidden = true;
    if (transparent) transparent.checked = false;

    const gleamRow = document.getElementById("pz-gleam-row");
    const gleam = document.getElementById("pz-gleam");
    const canGleam = !!(selectedMeta && selectedMeta.logoLike);
    if (gleamRow) gleamRow.hidden = !canGleam;
    if (!canGleam && gleam) gleam.checked = false;

    renderBreadcrumb();
    syncFormatOptions();
    updateGleamPreview();
    queueEstimate();
  }

  function renderBreadcrumb() {
    const host = document.getElementById("pz-breadcrumb");
    host.textContent = "";
    if (!selectedEl) return;
    const chain = [];
    let node = selectedEl;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      chain.unshift(node);
      if (node === document.body) break;
      node = node.parentElement;
      if (chain.length > 8) break;
    }
    chain.forEach((item, index) => {
      if (index) host.appendChild(document.createTextNode(" › "));
      host.appendChild(
        el(
          "button",
          {
            type: "button",
            className: "pz-crumb",
            onClick: () => setSelected(item)
          },
          [item.tagName.toLowerCase()]
        )
      );
    });
  }

  function syncFormatOptions() {
    const format = document.getElementById("pz-format");
    if (!format) return;
    const motion = !!(selectedMeta && selectedMeta.motion);
    const gleam = document.getElementById("pz-gleam")?.checked;
    const mascotNative = !!(selectedMeta && selectedMeta.logoLike);
    const transparent = mascotNative || gleam;
    const allowed = stillFormats({ motion, transparent, gleam });
    const current = format.value;
    format.innerHTML = "";
    allowed.forEach((value) => format.appendChild(el("option", { value }, [value.toUpperCase()])));
    if (gleam && allowed.includes("gif")) format.value = "gif";
    else format.value = allowed.includes(current) ? current : allowed[0];

    const isMotion = format.value === "mp4" || format.value === "gif";
    document.getElementById("pz-motion-fields").hidden = !isMotion;
    const gleamSizeRow = document.getElementById("pz-gleam-size-row");
    if (gleamSizeRow) gleamSizeRow.hidden = !gleam;
    const qualityRow = document.getElementById("pz-quality-row");
    qualityRow.hidden = !(format.value === "jpeg" || format.value === "png" || format.value === "gif");
    const qualityLabel = document.getElementById("pz-quality-label");
    if (format.value === "jpeg") qualityLabel.textContent = "JPEG quality";
    else if (format.value === "png") qualityLabel.textContent = "PNG compression";
    else qualityLabel.textContent = "GIF colors";
  }

  function qualityPreset() {
    return QUALITY_PRESETS.ultra;
  }

  function collectExportBody() {
    const colors = activeColors();
    const format = document.getElementById("pz-format").value;
    const preset = qualityPreset();
    const gleam = !!document.getElementById("pz-gleam")?.checked;
    const gleamSize = Number(document.getElementById("pz-gleam-size")?.value || 256);
    const mascotNative = !!(selectedMeta && selectedMeta.logoLike);
    return {
      mode: format,
      target: selectedMeta?.slug || selectedMeta?.exportId || "element",
      selector: selectedMeta?.selector,
      scale: preset.scale,
      longEdge: gleam ? gleamSize : preset.longEdge,
      fps: Number(document.getElementById("pz-fps").value || (format === "gif" ? 16 : 30)),
      duration: Number(document.getElementById("pz-duration").value || 3.4),
      quality: Number(document.getElementById("pz-quality").value || 92),
      // Logo/mascot assets are already transparent PNGs.
      // Still exports use the source file; gleam builds a square GIF over it.
      transparent: mascotNative || gleam,
      nativeAlpha: mascotNative || gleam,
      gleam,
      logoAsset: state.logoAsset,
      gold: colors.gold,
      sat: colors.sat,
      bright: colors.bright,
      obsidian: state.obsidian,
      paper: state.paper
    };
  }

  function outputDimensions(body = collectExportBody()) {
    if (body.gleam && body.longEdge) {
      return { width: Number(body.longEdge), height: Number(body.longEdge) };
    }
    const preset = qualityPreset();
    const srcW = Math.max(1, Number(selectedMeta?.width) || 1);
    const srcH = Math.max(1, Number(selectedMeta?.height) || 1);
    if (preset.longEdge) {
      const long = Math.max(srcW, srcH);
      const scale = preset.longEdge / long;
      return { width: Math.max(1, Math.round(srcW * scale)), height: Math.max(1, Math.round(srcH * scale)) };
    }
    return {
      width: Math.max(1, Math.round(srcW * preset.scale)),
      height: Math.max(1, Math.round(srcH * preset.scale))
    };
  }

  function clientSideEstimate(body = collectExportBody()) {
    const { width, height } = outputDimensions(body);
    const pixels = width * height;
    const quality = Math.max(0.05, Math.min(1, (Number(body.quality) || 92) / 100));
    const fps = Math.max(1, Number(body.fps) || (body.mode === "gif" ? 16 : 30));
    const duration = Math.max(0.2, Number(body.duration) || 3.4);
    let bytes;
    switch (body.mode) {
      case "jpeg":
      case "jpg":
        bytes = Math.round(pixels * (0.08 + 0.4 * quality));
        break;
      case "webp":
        bytes = Math.round(pixels * (0.05 + 0.28 * quality));
        break;
      case "gif":
        bytes = Math.round(pixels * 0.28 * Math.min(fps, 24) * Math.min(duration, 4) * 0.12);
        break;
      case "mp4":
        bytes = Math.round(pixels * 0.1 * duration);
        break;
      default:
        bytes = Math.round(pixels * (body.transparent || body.nativeAlpha ? 2.1 : 1.35));
    }
    return { bytes: Math.max(1024, bytes), width, height, approx: true };
  }

  async function readExportPayload(response) {
    const text = await response.text();
    const type = (response.headers.get("content-type") || "").toLowerCase();
    const trimmed = text.trim();
    if (!type.includes("application/json") && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      const err = new Error("Export API unavailable on this host");
      err.code = "EXPORT_API_UNAVAILABLE";
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      const err = new Error("Export API unavailable on this host");
      err.code = "EXPORT_API_UNAVAILABLE";
      throw err;
    }
  }

  function queueEstimate() {
    clearTimeout(estimateTimer);
    const estimateEl = document.getElementById("pz-estimate");
    if (!selectedMeta) {
      estimateEl.textContent = "Estimated size: —";
      return;
    }
    const dims = outputDimensions();
    estimateEl.textContent = `Estimating… target ~${Math.max(dims.width, dims.height)}px long edge`;
    estimateTimer = setTimeout(runEstimate, 260);
  }

  async function runEstimate() {
    const estimateEl = document.getElementById("pz-estimate");
    if (!selectedMeta || !selectedEl) {
      estimateEl.textContent = "Estimated size: —";
      return;
    }
    const body = collectExportBody();
    const exporter = window.PressZeroBrowserExport;
    const approx =
      (exporter?.estimateSelection && exporter.estimateSelection(selectedEl, body)) ||
      clientSideEstimate(body);
    const dims = approx.width && approx.height ? ` · ${approx.width}×${approx.height}px` : "";
    estimateEl.textContent = `Estimated size: ~${formatBytes(approx.bytes)}${dims}`;
  }

  async function runBrowserExport(body, status) {
    const exporter = window.PressZeroBrowserExport;
    if (!exporter?.exportSelection) {
      throw new Error("Browser export failed to load. Refresh and try again.");
    }
    const result = await exporter.exportSelection(selectedEl, body, {
      onProgress: (done, total) => {
        status.textContent = `Exporting frame ${done}/${total}…`;
      }
    });
    const url = URL.createObjectURL(result.blob);
    const dims = result.width && result.height ? ` ${result.width}×${result.height}px · ` : " ";
    const sourceNote = result.sourceAsset ? " (source PNG) " : " ";
    status.textContent = "";
    status.append(
      document.createTextNode(`Saved${dims}${formatBytes(result.blob.size)}.${sourceNote}`),
      el("a", { className: "pz-link", href: url, download: result.filename }, ["Download"])
    );
    document.getElementById("pz-estimate").textContent =
      `Estimated size: ${formatBytes(result.blob.size)}${result.width ? ` · ${result.width}×${result.height}px` : ""}`;
    return result;
  }

  function updateHistoryButtons() {
    const undoBtn = document.getElementById("pz-undo");
    const redoBtn = document.getElementById("pz-redo");
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function syncForm() {
    const colors = activeColors();
    document.querySelectorAll("[data-asset]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-asset") === state.logoAsset);
    });
    document.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-preset") === (state.preset || "ember"));
    });
    const gold = document.getElementById("pz-gold");
    const sat = document.getElementById("pz-sat");
    const bright = document.getElementById("pz-bright");
    if (gold) gold.value = colors.gold;
    if (sat) sat.value = String(colors.sat);
    if (bright) bright.value = String(colors.bright);
    const satVal = document.getElementById("pz-sat-val");
    const brightVal = document.getElementById("pz-bright-val");
    if (satVal) satVal.textContent = String(colors.sat);
    if (brightVal) brightVal.textContent = String(colors.bright);
    const note = document.getElementById("pz-asset-note");
    if (note) note.textContent = `Colours apply only to ${state.logoAsset}.`;
    updateHistoryButtons();
  }

  function mount() {
    if (document.getElementById("pz-local-controls")) return;

    const style = el("style", {}, [
      `#pz-local-controls{position:fixed;top:16px;right:16px;z-index:2147483646;width:320px;max-height:calc(100vh - 32px);overflow:auto;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#ececec;background:#2b2b2f;border:1px solid rgba(255,255,255,.08);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
#pz-local-controls *{box-sizing:border-box}
#pz-local-controls.pz-hidden{display:none}
#pz-reopen{position:fixed;top:16px;right:16px;z-index:2147483646;display:none;border:0;border-radius:999px;padding:10px 14px;background:#2b2b2f;color:#fff;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35)}
#pz-reopen.pz-show{display:inline-flex}
#pz-local-controls .pz-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px}
#pz-local-controls .pz-title{font-size:18px;font-weight:600;letter-spacing:-.01em}
#pz-local-controls .pz-x{appearance:none;border:0;background:transparent;color:#bdbdbd;font-size:18px;cursor:pointer;line-height:1}
#pz-local-controls .pz-body{padding:0 16px 16px;display:grid;gap:16px}
#pz-local-controls .pz-section-label{font-size:12px;color:#9a9a9e;margin:0 0 8px}
#pz-local-controls .pz-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:0;background:#1f1f23;border-radius:10px;padding:3px}
#pz-local-controls .pz-seg button{appearance:none;border:0;background:transparent;color:#d7d7db;border-radius:8px;padding:8px 6px;font-size:12px;cursor:pointer}
#pz-local-controls .pz-seg button.is-active{background:#3a3a40;color:#fff}
#pz-local-controls .pz-field{display:grid;gap:8px;margin-top:10px}
#pz-local-controls .pz-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
#pz-local-controls .pz-key{color:#cfcfd4;font-size:13px}
#pz-local-controls .pz-val{color:#a7a7ad;font-variant-numeric:tabular-nums;min-width:28px;text-align:right}
#pz-local-controls input[type=color]{width:54px;height:28px;border:0;padding:0;background:transparent;border-radius:8px;overflow:hidden;cursor:pointer}
#pz-local-controls input[type=color]::-webkit-color-swatch-wrapper{padding:0}
#pz-local-controls input[type=color]::-webkit-color-swatch{border:0;border-radius:8px}
#pz-local-controls input[type=range]{width:100%;accent-color:#8d8d93}
#pz-local-controls .pz-hint{font-size:11px;color:#8f8f96;margin-top:6px}
#pz-local-controls .pz-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
#pz-local-controls .pz-tools button,#pz-local-controls .pz-btn{appearance:none;border:0;border-radius:9px;padding:9px 8px;background:#3a3a40;color:#fff;cursor:pointer;font-size:12px}
#pz-local-controls .pz-tools button:disabled{opacity:.35;cursor:default}
#pz-local-controls .pz-btn-primary{background:#e8892e;color:#1a120a;font-weight:600}
#pz-local-controls select,#pz-local-controls input[type=number]{width:100%;border:1px solid rgba(255,255,255,.1);background:#1f1f23;color:#fff;border-radius:8px;padding:8px 10px}
#pz-local-controls .pz-selected-box{padding:10px 12px;border-radius:10px;background:#1f1f23;color:#d7d7db;font-size:12px;word-break:break-word}
#pz-local-controls .pz-check{display:flex;align-items:center;gap:8px;color:#cfcfd4;font-size:12px}
#pz-local-controls .pz-status{min-height:1.3em;color:#9a9a9e;font-size:12px;white-space:pre-wrap}
#pz-local-controls .pz-link{color:#e2a985;text-decoration:none}
#pz-local-controls .pz-divider{height:1px;background:rgba(255,255,255,.08);margin:2px 0}
#pz-local-controls .pz-crumb{appearance:none;border:0;background:transparent;color:#e2a985;cursor:pointer;padding:0;font-size:11px}
#pz-hover-box{position:fixed;pointer-events:none;z-index:2147483645;border:1px solid rgba(232,137,46,.85);box-shadow:0 0 0 1px rgba(0,0,0,.35);display:none;border-radius:2px}
.pz-selected-el{outline:2px solid #e8892e !important;outline-offset:3px !important}
body.pz-inspecting, body.pz-inspecting *{cursor:crosshair !important}`
    ]);

    const panel = el("aside", { id: "pz-local-controls" }, [
      el("div", { className: "pz-head" }, [
        el("div", { className: "pz-title" }, ["Tweaks"]),
        el("button", {
          className: "pz-x",
          type: "button",
          onClick: () => {
            panel.classList.add("pz-hidden");
            document.getElementById("pz-reopen").classList.add("pz-show");
          }
        }, ["×"])
      ]),
      el("div", { className: "pz-body" }, [
        el("div", {}, [
          el("div", { className: "pz-section-label" }, ["Logo"]),
          el("div", { className: "pz-key", style: { marginBottom: "8px" } }, ["logoAsset"]),
          el(
            "div",
            { className: "pz-seg" },
            ASSETS.map((asset) =>
              el(
                "button",
                {
                  type: "button",
                  "data-asset": asset,
                  className: asset === state.logoAsset ? "is-active" : "",
                  onClick: () => {
                    if (asset === "Tilted V1" && (state.preset === "ember" || state.preset === "original")) {
                      setState({ logoAsset: asset });
                    } else {
                      setState({ logoAsset: asset, preset: asset === "Tilted V1" ? state.preset || "ember" : "custom" });
                    }
                    const nest = document.getElementById("pz-v1-presets");
                    if (nest) nest.hidden = asset !== "Tilted V1";
                  }
                },
                [asset]
              )
            )
          ),
          el("div", {
            id: "pz-v1-presets",
            hidden: state.logoAsset !== "Tilted V1",
            style: {
              marginTop: "10px",
              marginLeft: "10px",
              paddingLeft: "12px",
              borderLeft: "2px solid rgba(255,255,255,.12)"
            }
          }, [
            el("div", { className: "pz-key", style: { marginBottom: "8px" } }, ["Tilted V1 presets"]),
            el(
              "div",
              { className: "pz-seg", style: { gridTemplateColumns: "1fr 1fr" } },
              Object.values(PRESETS).map((preset) =>
                el(
                  "button",
                  {
                    type: "button",
                    "data-preset": preset.id,
                    className: (state.preset || "ember") === preset.id ? "is-active" : "",
                    onClick: () => applyPreset(preset.id)
                  },
                  [preset.label]
                )
              )
            ),
            el("div", { className: "pz-hint" }, ["Ember V1 is default. Original Gold is the prior freeze."])
          ]),
          el("div", { className: "pz-hint", id: "pz-asset-note" }, [`Colours apply only to ${state.logoAsset}.`])
        ]),
        el("div", {}, [
          el("div", { className: "pz-section-label" }, ["Colours"]),
          el("div", { className: "pz-field" }, [
            el("div", { className: "pz-row" }, [
              el("span", { className: "pz-key" }, ["gold"]),
              el("input", {
                id: "pz-gold",
                type: "color",
                value: activeColors().gold,
                onInput: (event) => updateAssetColor({ gold: event.target.value }, { record: false }),
                onChange: (event) => updateAssetColor({ gold: event.target.value })
              })
            ]),
            el("div", {}, [
              el("div", { className: "pz-row" }, [
                el("span", { className: "pz-key" }, ["sat"]),
                el("span", { className: "pz-val", id: "pz-sat-val" }, [String(activeColors().sat)])
              ]),
              el("input", {
                id: "pz-sat",
                type: "range",
                min: "0.4",
                max: "1.6",
                step: "0.05",
                value: String(activeColors().sat),
                onInput: (event) => {
                  document.getElementById("pz-sat-val").textContent = event.target.value;
                  updateAssetColor({ sat: Number(event.target.value) }, { record: false });
                },
                onChange: (event) => updateAssetColor({ sat: Number(event.target.value) })
              })
            ]),
            el("div", {}, [
              el("div", { className: "pz-row" }, [
                el("span", { className: "pz-key" }, ["bright"]),
                el("span", { className: "pz-val", id: "pz-bright-val" }, [String(activeColors().bright)])
              ]),
              el("input", {
                id: "pz-bright",
                type: "range",
                min: "0.6",
                max: "1.5",
                step: "0.05",
                value: String(activeColors().bright),
                onInput: (event) => {
                  document.getElementById("pz-bright-val").textContent = event.target.value;
                  updateAssetColor({ bright: Number(event.target.value) }, { record: false });
                },
                onChange: (event) => updateAssetColor({ bright: Number(event.target.value) })
              })
            ])
          ])
        ]),
        el("div", { className: "pz-tools" }, [
          el("button", { id: "pz-undo", type: "button", onClick: undo }, ["Undo"]),
          el("button", { id: "pz-redo", type: "button", onClick: redo }, ["Redo"]),
          el("button", { type: "button", onClick: resetDefaults }, ["Reset"])
        ]),
        el("div", { className: "pz-divider" }),
        el("div", {}, [
          el("div", { className: "pz-section-label" }, ["Export"]),
          el("div", { className: "pz-hint" }, [
            "Select any element → Export PNG/JPEG in-browser. Logo marks: PNG from source asset. Optional gleam → GIF."
          ]),
          el("label", { className: "pz-check", style: { marginTop: "8px" } }, [
            el("input", {
              type: "checkbox",
              checked: true,
              onChange: (event) => {
                selectMode = event.target.checked;
                document.body.classList.toggle("pz-inspecting", selectMode);
                if (!selectMode) {
                  const box = document.getElementById("pz-hover-box");
                  if (box) box.style.display = "none";
                }
              }
            }),
            "Inspect / select any element"
          ]),
          el("div", { className: "pz-selected-box", id: "pz-selected-label", style: { marginTop: "8px" } }, [
            "None — click any element"
          ]),
          el("div", { className: "pz-hint", id: "pz-selected-info" }, [""]),
          el("div", { id: "pz-breadcrumb", style: { marginTop: "8px" } }),
          el("div", { id: "pz-gleam-row", hidden: true, style: { marginTop: "10px" } }, [
            el("label", { className: "pz-check" }, [
              el("input", {
                id: "pz-gleam",
                type: "checkbox",
                onChange: () => {
                  syncFormatOptions();
                  updateGleamPreview();
                  queueEstimate();
                }
              }),
              "Add gleam on mascot"
            ]),
            el("div", { className: "pz-hint" }, [
              "Preview sweeps on the selected logo. Export is a square animated GIF."
            ])
          ]),
          el("div", { className: "pz-field", id: "pz-gleam-size-row", hidden: true }, [
            el("div", { className: "pz-key" }, ["Gleam GIF size"]),
            el("select", { id: "pz-gleam-size", onChange: queueEstimate }, [
              el("option", { value: "128" }, ["Favicon · 128px"]),
              el("option", { value: "256", selected: true }, ["Email / social · 256px"]),
              el("option", { value: "512" }, ["Large · 512px"]),
              el("option", { value: "1024" }, ["XL · 1024px"])
            ])
          ]),
          el("div", { className: "pz-field" }, [
            el("div", { className: "pz-key" }, ["Format"]),
            el("select", { id: "pz-format", onChange: () => { syncFormatOptions(); queueEstimate(); } }, [
              el("option", { value: "png" }, ["PNG"]),
              el("option", { value: "jpeg" }, ["JPEG"])
            ])
          ]),
          el("div", { className: "pz-field", id: "pz-quality-row" }, [
            el("div", { className: "pz-row" }, [
              el("span", { className: "pz-key", id: "pz-quality-label" }, ["PNG compression"]),
              el("span", { className: "pz-val", id: "pz-quality-val" }, ["92"])
            ]),
            el("input", {
              id: "pz-quality",
              type: "range",
              min: "40",
              max: "100",
              step: "1",
              value: "92",
              onInput: (event) => {
                document.getElementById("pz-quality-val").textContent = event.target.value;
                queueEstimate();
              }
            })
          ]),
          el("div", { id: "pz-motion-fields", hidden: true }, [
            el("div", { className: "pz-field" }, [
              el("div", { className: "pz-key" }, ["FPS"]),
              el("input", { id: "pz-fps", type: "number", min: "8", max: "60", value: "16", onChange: queueEstimate })
            ]),
            el("div", { className: "pz-field" }, [
              el("div", { className: "pz-key" }, ["Duration (sec)"]),
              el("input", {
                id: "pz-duration",
                type: "number",
                min: "0.5",
                max: "8",
                step: "0.1",
                value: "3.4",
                onChange: queueEstimate
              })
            ])
          ]),
          el("div", { id: "pz-transparent-row", hidden: true, style: { marginTop: "10px" } }, [
            el("label", { className: "pz-check" }, [
              el("input", {
                id: "pz-transparent",
                type: "checkbox",
                onChange: () => {
                  syncFormatOptions();
                  queueEstimate();
                }
              }),
              "Transparent background"
            ])
          ]),
          el("div", { className: "pz-hint", id: "pz-estimate", style: { marginTop: "10px" } }, [
            "Estimated size: —"
          ]),
          el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" } }, [
            el("button", {
              className: "pz-btn pz-btn-primary",
              type: "button",
              onClick: async () => {
                const status = document.getElementById("pz-status");
                if (!selectedMeta || !selectedEl) {
                  status.textContent = "Select an element first.";
                  return;
                }
                if (document.getElementById("pz-gleam")?.checked && !selectedMeta.logoLike) {
                  status.textContent = "Gleam needs a logo/mascot selection.";
                  return;
                }
                const body = collectExportBody();
                if (body.gleam && body.mode !== "gif") {
                  status.textContent = "Gleam export needs GIF.";
                  return;
                }
                status.textContent = body.gleam
                  ? `Exporting gleam GIF (${body.longEdge}px)…`
                  : body.mode === "gif"
                    ? `Exporting ${body.target} as GIF…`
                    : `Exporting ${body.target} as ${body.mode.toUpperCase()}…`;
                try {
                  await runBrowserExport(body, status);
                } catch (error) {
                  status.textContent = String(error.message || error);
                }
              }
            }, ["Export"]),
            el("button", {
              className: "pz-btn",
              type: "button",
              onClick: () => selectedEl?.scrollIntoView({ behavior: "smooth", block: "center" })
            }, ["Jump"])
          ]),
          el("div", { className: "pz-status", id: "pz-status" }, ["Ready."])
        ])
      ])
    ]);

    const reopen = el(
      "button",
      {
        id: "pz-reopen",
        type: "button",
        onClick: () => {
          panel.classList.remove("pz-hidden");
          reopen.classList.remove("pz-show");
        }
      },
      ["Tweaks"]
    );

    const hoverBox = el("div", { id: "pz-hover-box" });

    document.head.appendChild(style);
    document.body.appendChild(panel);
    document.body.appendChild(reopen);
    document.body.appendChild(hoverBox);
    document.body.classList.add("pz-inspecting");

    document.addEventListener(
      "mousemove",
      (event) => {
        if (!selectMode) return;
        const target = event.target;
        if (!(target instanceof Element) || isUiChrome(target)) {
          hoverBox.style.display = "none";
          return;
        }
        hoverEl = target;
        placeHoverBox(target);
      },
      true
    );

    document.addEventListener(
      "click",
      (event) => {
        if (!selectMode) return;
        if (isUiChrome(event.target)) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        event.preventDefault();
        event.stopPropagation();
        setSelected(target);
      },
      true
    );

    window.addEventListener("scroll", () => {
      if (selectedEl) selectedEl.classList.add("pz-selected-el");
      if (hoverEl && selectMode) placeHoverBox(hoverEl);
    }, true);

    applyToRuntime(state);
    syncForm();
    syncFormatOptions();
  }

  if (new URLSearchParams(window.location.search).get("exportUI") === "0") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(mount, 80));
  } else {
    setTimeout(mount, 80);
  }
})();
