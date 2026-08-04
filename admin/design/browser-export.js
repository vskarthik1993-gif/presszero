/**
 * In-browser export for the Design page (works on static hosting).
 * Stills via html-to-image; gleam GIFs via canvas frames + gifenc.
 */
(() => {
  const MAX_PIXEL_RATIO = 8;
  const MAX_EDGE = 4096;

  let gifencModulePromise = null;

  function loadGifenc() {
    if (!gifencModulePromise) {
      // Resolve relative to this page (/admin/design/canvas.html).
      gifencModulePromise = import("./vendor/gifenc.esm.js");
    }
    return gifencModulePromise;
  }

  function htmlToImage() {
    const api = window.htmlToImage;
    if (!api?.toCanvas) {
      throw new Error("html-to-image failed to load.");
    }
    return api;
  }

  function findLogoImg(node) {
    if (!node) return null;
    if (node.tagName === "IMG" && /logo-ring/i.test(node.getAttribute("src") || node.currentSrc || "")) {
      return node;
    }
    return (
      [...node.querySelectorAll("img")].find((img) =>
        /logo-ring/i.test(img.getAttribute("src") || img.currentSrc || "")
      ) || null
    );
  }

  function hideUiChrome() {
    const ids = ["pz-local-controls", "pz-reopen", "pz-hover-box", "pz-gleam-preview", "pz-admin-overlay"];
    const touched = [];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      touched.push({ el, display: el.style.display, visibility: el.style.visibility });
      el.style.visibility = "hidden";
    });
    const selected = [...document.querySelectorAll(".pz-selected-el")];
    selected.forEach((node) => node.classList.remove("pz-selected-el"));
    return () => {
      touched.forEach(({ el, display, visibility }) => {
        el.style.display = display;
        el.style.visibility = visibility;
      });
      selected.forEach((node) => node.classList.add("pz-selected-el"));
    };
  }

  function pixelRatioFor(el, longEdge, scale) {
    const rect = el.getBoundingClientRect();
    const cssLong = Math.max(rect.width, rect.height, 1);
    if (longEdge && longEdge > 0) {
      return Math.min(MAX_PIXEL_RATIO, Math.max(1, longEdge / cssLong));
    }
    return Math.min(MAX_PIXEL_RATIO, Math.max(1, Number(scale) || 2));
  }

  function clampCanvasSize(canvas) {
    const long = Math.max(canvas.width, canvas.height);
    if (long <= MAX_EDGE) return canvas;
    const ratio = MAX_EDGE / long;
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(canvas.width * ratio));
    next.height = Math.max(1, Math.round(canvas.height * ratio));
    const ctx = next.getContext("2d");
    ctx.drawImage(canvas, 0, 0, next.width, next.height);
    return next;
  }

  async function canvasToBlob(canvas, mode, quality) {
    const q = Math.max(0.05, Math.min(1, (Number(quality) || 92) / 100));
    const type =
      mode === "jpeg" || mode === "jpg"
        ? "image/jpeg"
        : mode === "webp"
          ? "image/webp"
          : "image/png";
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Failed to encode image."))),
        type,
        type === "image/png" ? undefined : q
      );
    });
    return blob;
  }

  async function loadImage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load image (${response.status}).`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image failed to decode."));
        img.src = objectUrl;
      });
      return { img, blob, objectUrl };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  async function exportSourceAsset(img, body) {
    const sourceUrl = img.currentSrc || img.src;
    const { img: decoded, objectUrl } = await loadImage(sourceUrl);
    try {
      const naturalLong = Math.max(decoded.naturalWidth, decoded.naturalHeight, 1);
      const targetLong = body.longEdge || naturalLong;
      const scale = Math.min(MAX_EDGE / naturalLong, targetLong / naturalLong);
      const width = Math.max(1, Math.round(decoded.naturalWidth * scale));
      const height = Math.max(1, Math.round(decoded.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(decoded, 0, 0, width, height);
      const mode = body.mode === "jpg" ? "jpeg" : body.mode || "png";
      const blob = await canvasToBlob(canvas, mode === "png" ? "png" : mode, body.quality);
      return {
        blob,
        width,
        height,
        filename: `${body.target || "logo"}.${mode === "jpeg" ? "jpg" : mode}`,
        sourceAsset: true
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function captureElementCanvas(el, { longEdge, scale, transparent, backgroundColor, manageChrome = true }) {
    const restore = manageChrome ? hideUiChrome() : () => {};
    try {
      await document.fonts.ready;
      const ratio = pixelRatioFor(el, longEdge, scale);
      const opts = {
        pixelRatio: ratio,
        cacheBust: true,
        skipFonts: false,
        style: {
          transform: "none",
          margin: "0"
        }
      };
      if (!transparent && backgroundColor) opts.backgroundColor = backgroundColor;
      const canvas = clampCanvasSize(await htmlToImage().toCanvas(el, opts));
      return canvas;
    } finally {
      restore();
    }
  }

  async function exportStill(el, body) {
    if (body.nativeAlpha && !body.gleam && (body.mode === "png" || !body.mode)) {
      const logo = findLogoImg(el);
      if (logo) return exportSourceAsset(logo, { ...body, mode: "png" });
    }

    const transparent = !!(body.transparent || body.nativeAlpha);
    const canvas = await captureElementCanvas(el, {
      longEdge: body.longEdge,
      scale: body.scale,
      transparent,
      backgroundColor: transparent ? undefined : body.paper || "#F5F3EF"
    });
    const mode = body.mode === "jpg" ? "jpeg" : body.mode || "png";
    const blob = await canvasToBlob(canvas, mode, body.quality);
    return {
      blob,
      width: canvas.width,
      height: canvas.height,
      filename: `${body.target || "element"}.${mode === "jpeg" ? "jpg" : mode}`,
      sourceAsset: false
    };
  }

  function gleamProgress(timeMs, durationMs = 3400) {
    const t = ((timeMs % durationMs) + durationMs) % durationMs;
    const progress = Math.min(1, t / (durationMs * 0.55));
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    return -160 + (360 - -160) * eased;
  }

  async function buildGleamStage(el, size) {
    const img = findLogoImg(el);
    if (!img) {
      throw new Error("No logo mascot found in selection. Click the ring/logo image, then enable gleam.");
    }

    document.getElementById("pz-gleam-stage")?.remove();

    const guide =
      document.querySelector('[data-export-id="guide-root"]') ||
      document.querySelector("#dc-root") ||
      document.body;
    const guideStyles = getComputedStyle(guide);
    const sourceUrl = img.currentSrc || img.src;
    const { objectUrl } = await loadImage(sourceUrl);

    const stage = document.createElement("div");
    stage.id = "pz-gleam-stage";
    stage.style.cssText = [
      "position:fixed",
      "left:0",
      "top:0",
      `width:${size}px`,
      `height:${size}px`,
      "margin:0",
      "padding:0",
      "background:transparent",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "pointer-events:none",
      "z-index:2147483000"
    ].join(";");

    ["--gold", "--gleam-rgb", "--obsidian", "--paper", "--logo-filter"].forEach((prop) => {
      const value = guideStyles.getPropertyValue(prop);
      if (value) stage.style.setProperty(prop, value);
    });
    if (!(stage.style.getPropertyValue("--gleam-rgb") || "").trim()) {
      stage.style.setProperty("--gleam-rgb", "255, 204, 214");
    }

    const frame = document.createElement("div");
    frame.style.cssText = "position:relative;width:78%;height:78%;";

    const cloneImg = document.createElement("img");
    cloneImg.alt = "";
    cloneImg.src = objectUrl;
    cloneImg.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:var(--logo-filter);";
    await new Promise((resolve, reject) => {
      if (cloneImg.complete && cloneImg.naturalWidth > 0) resolve();
      else {
        cloneImg.onload = () => resolve();
        cloneImg.onerror = () => reject(new Error("Gleam logo failed to load."));
      }
    });

    const wrap = document.createElement("div");
    wrap.setAttribute("data-pz-gleam", "1");
    wrap.style.cssText = [
      "position:absolute",
      "inset:0",
      "overflow:hidden",
      "pointer-events:none",
      "z-index:2",
      `-webkit-mask-image:url("${objectUrl}")`,
      "-webkit-mask-size:contain",
      "-webkit-mask-repeat:no-repeat",
      "-webkit-mask-position:center",
      `mask-image:url("${objectUrl}")`,
      "mask-size:contain",
      "mask-repeat:no-repeat",
      "mask-position:center"
    ].join(";");

    const band = document.createElement("div");
    band.setAttribute("data-pz-gleam-band", "1");
    band.style.cssText = [
      "position:absolute",
      "top:-30%",
      "left:0",
      "width:56%",
      "height:160%",
      "background:linear-gradient(90deg, rgba(var(--gleam-rgb),0) 0%, rgba(var(--gleam-rgb),0.9) 40%, rgba(255,236,240,0.9) 50%, rgba(var(--gleam-rgb),0.9) 60%, rgba(var(--gleam-rgb),0) 100%)",
      "filter:blur(2px)",
      "transform:translateX(-160%) skewX(-16deg)",
      "will-change:transform",
      "animation:none"
    ].join(";");

    wrap.appendChild(band);
    frame.appendChild(cloneImg);
    frame.appendChild(wrap);
    stage.appendChild(frame);
    document.body.appendChild(stage);

    return {
      stage,
      band,
      cleanup() {
        stage.remove();
        URL.revokeObjectURL(objectUrl);
      }
    };
  }

  async function exportGleamGif(el, body, onProgress) {
    const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
    const size = Math.max(64, Math.min(MAX_EDGE, Number(body.longEdge) || 256));
    const fps = Math.max(6, Math.min(24, Number(body.fps) || 16));
    const duration = Math.max(0.8, Math.min(4, Number(body.duration) || 3.4));
    const frameCount = Math.max(8, Math.round(fps * duration));
    const delayMs = Math.round(1000 / fps);
    const maxColors = Math.max(32, Math.min(256, Math.round(Number(body.quality) || 92) * 2.55));

    const restore = hideUiChrome();
    const gleam = await buildGleamStage(el, size);
    try {
      const encoder = GIFEncoder();
      let width = size;
      let height = size;

      for (let index = 0; index < frameCount; index += 1) {
        const timeMs = (index / fps) * 1000;
        const x = gleamProgress(timeMs, duration * 1000);
        gleam.band.style.transform = `translateX(${x}%) skewX(-16deg)`;
        // Force layout before capture.
        void gleam.stage.offsetWidth;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await htmlToImage().toCanvas(gleam.stage, {
          pixelRatio: 1,
          cacheBust: false,
          width: size,
          height: size,
          style: { margin: "0", transform: "none" }
        });
        width = canvas.width;
        height = canvas.height;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.getImageData(0, 0, width, height);
        const palette = quantize(imageData.data, Math.floor(maxColors), {
          format: "rgba4444",
          clearAlpha: true,
          clearAlphaThreshold: 64
        });
        const indexMap = applyPalette(imageData.data, palette, "rgba4444");
        const transparentIndex = palette.findIndex((color) => (color[3] ?? 255) < 64);
        encoder.writeFrame(indexMap, width, height, {
          palette,
          delay: delayMs,
          dispose: 2,
          transparent: transparentIndex >= 0,
          transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
          repeat: index === 0 ? 0 : undefined
        });
        if (onProgress) onProgress(index + 1, frameCount);
      }

      encoder.finish();
      const bytes = encoder.bytes();
      const blob = new Blob([bytes], { type: "image/gif" });
      return {
        blob,
        width,
        height,
        filename: `${body.target || "gleam"}.gif`,
        sourceAsset: false
      };
    } finally {
      gleam.cleanup();
      restore();
    }
  }

  async function exportMotionGif(el, body, onProgress) {
    const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
    const fps = Math.max(6, Math.min(24, Number(body.fps) || 16));
    const duration = Math.max(0.8, Math.min(4, Number(body.duration) || 3.4));
    const frameCount = Math.max(8, Math.round(fps * duration));
    const delayMs = Math.round(1000 / fps);
    const maxColors = Math.max(32, Math.min(256, Math.round(Number(body.quality) || 92) * 2.55));
    const restore = hideUiChrome();

    try {
      const animations = document.getAnimations({ subtree: true }).filter((animation) => {
        const target = animation.effect?.target;
        return target instanceof Element && (el === target || el.contains(target));
      });
      animations.forEach((animation) => {
        animation.pause();
        animation.currentTime = 0;
      });

      const encoder = GIFEncoder();
      let width = 0;
      let height = 0;

      for (let index = 0; index < frameCount; index += 1) {
        const timeMs = (index / fps) * 1000;
        animations.forEach((animation) => {
          animation.currentTime = timeMs;
        });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await captureElementCanvas(el, {
          longEdge: body.longEdge,
          scale: body.scale,
          transparent: !!(body.transparent || body.nativeAlpha),
          backgroundColor: body.paper || "#0B0B0D",
          manageChrome: false
        });
        width = canvas.width;
        height = canvas.height;
        const ctx = canvas.getContext("2d");
        const imageData = ctx.getImageData(0, 0, width, height);
        const palette = quantize(imageData.data, Math.floor(maxColors), {
          format: "rgba4444",
          clearAlpha: true,
          clearAlphaThreshold: 64
        });
        const indexMap = applyPalette(imageData.data, palette, "rgba4444");
        const transparentIndex = palette.findIndex((color) => (color[3] ?? 255) < 64);
        encoder.writeFrame(indexMap, width, height, {
          palette,
          delay: delayMs,
          dispose: 2,
          transparent: transparentIndex >= 0,
          transparentIndex: transparentIndex >= 0 ? transparentIndex : 0,
          repeat: index === 0 ? 0 : undefined
        });
        if (onProgress) onProgress(index + 1, frameCount);
      }

      encoder.finish();
      const blob = new Blob([encoder.bytes()], { type: "image/gif" });
      return {
        blob,
        width,
        height,
        filename: `${body.target || "motion"}.gif`,
        sourceAsset: false
      };
    } finally {
      restore();
    }
  }

  async function exportSelection(el, body, { onProgress } = {}) {
    if (!el) throw new Error("Select an element first.");
    if (body.mode === "mp4") {
      throw new Error("MP4 export in the browser is next. Use GIF for now.");
    }
    if (body.gleam) {
      if (body.mode !== "gif") throw new Error("Gleam export needs GIF.");
      return exportGleamGif(el, body, onProgress);
    }
    if (body.mode === "gif") {
      return exportMotionGif(el, body, onProgress);
    }
    return exportStill(el, body);
  }

  function estimateSelection(el, body) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    let width;
    let height;
    if (body.gleam && body.longEdge) {
      width = height = Number(body.longEdge) || 256;
    } else if (body.longEdge) {
      const long = Math.max(rect.width, rect.height, 1);
      const scale = body.longEdge / long;
      width = Math.max(1, Math.round(rect.width * scale));
      height = Math.max(1, Math.round(rect.height * scale));
    } else {
      const scale = Number(body.scale) || 2;
      width = Math.max(1, Math.round(rect.width * scale));
      height = Math.max(1, Math.round(rect.height * scale));
    }
    width = Math.min(MAX_EDGE, width);
    height = Math.min(MAX_EDGE, height);
    const pixels = width * height;
    const quality = Math.max(0.05, Math.min(1, (Number(body.quality) || 92) / 100));
    const fps = Math.max(1, Number(body.fps) || 16);
    const duration = Math.max(0.2, Number(body.duration) || 3.4);
    let bytes;
    if (body.mode === "gif") {
      bytes = Math.round(pixels * 0.22 * Math.min(fps, 20) * Math.min(duration, 3.4) * 0.12);
    } else if (body.mode === "jpeg" || body.mode === "jpg") {
      bytes = Math.round(pixels * (0.08 + 0.4 * quality));
    } else if (body.mode === "webp") {
      bytes = Math.round(pixels * (0.05 + 0.28 * quality));
    } else {
      bytes = Math.round(pixels * (body.transparent || body.nativeAlpha || body.gleam ? 2.1 : 1.35));
    }
    return { bytes: Math.max(1024, bytes), width, height, approx: true };
  }

  window.PressZeroBrowserExport = {
    exportSelection,
    estimateSelection,
    findLogoImg
  };
})();
