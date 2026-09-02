import { createScrubber } from "./scrub.js?v=29";
import { createReceptionMascot } from "./mascot.js?v=29";

const ASSET = (name) => new URL(`./assets/${name}?v=29`, import.meta.url).href;

const ARROW_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`;

function waitFor(selector, root = document, timeout = 20000) {
  return new Promise((resolve) => {
    const found = root.querySelector(selector);
    if (found) {
      resolve(found);
      return;
    }
    const obs = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(root, { childList: true, subtree: true });
    window.setTimeout(() => {
      obs.disconnect();
      resolve(root.querySelector(selector));
    }, timeout);
  });
}

function setCue(cue, label) {
  cue.hidden = false;
  cue.querySelector(".pz-cue-label").textContent = label;
}

function hideCue(cue) {
  cue.hidden = true;
}

function alignDock(dock) {
  const native = document.querySelector(".demo-mobile-controls");
  if (!native) return;
  const rect = native.getBoundingClientRect();
  if (rect.height < 8) return;
  const host = document.getElementById("pz-phone") || document.documentElement;
  const hostRect = host.getBoundingClientRect();
  const bottom = Math.max(12, hostRect.bottom - rect.bottom);
  document.documentElement.style.setProperty("--pz-dock-bottom", `${bottom}px`);
}

function nativeButtons() {
  return {
    start: document.querySelector(".demo-callbtn--start"),
    mute: document.querySelector(".demo-callbtn--mute"),
    end: document.querySelector(".demo-callbtn--end"),
  };
}

function isCallLive() {
  const end = document.querySelector(".demo-callbtn--end");
  return Boolean(end && end.classList.contains("is-armed") && !end.disabled);
}

function isAgentSpeaking() {
  return Boolean(
    document.querySelector(".demo-mobile-caption__msg.is-agent.is-live") ||
      document.querySelector(".demo-mobile-caption__msg.is-agent:last-child"),
  );
}

function phoneShell() {
  let shell = document.getElementById("pz-phone");
  if (!shell) {
    shell = document.createElement("div");
    shell.id = "pz-phone";
    document.body.appendChild(shell);
  }
  return shell;
}

function buildDom() {
  const root = document.createElement("div");
  root.id = "pz-cinematic";
  root.className = "is-intro";
  root.innerHTML = `
    <div class="pz-media" data-layer="media">
      <div class="pz-loading">Preparing the lobby</div>
      <img class="pz-poster" alt="" src="${ASSET("scene-1-poster.jpg")}" />
      <video class="pz-clip" data-clip="0" playsinline muted preload="auto" poster="${ASSET("scene-1-poster.jpg")}" src="${ASSET("scene-1.mp4")}"></video>
      <video class="pz-clip" data-clip="1" playsinline muted preload="auto" poster="${ASSET("scene-2-poster.jpg")}" src="${ASSET("scene-2.mp4")}"></video>
      <video class="pz-clip" data-clip="2" playsinline muted preload="auto" poster="${ASSET("scene-3-poster.jpg")}" src="${ASSET("scene-3.mp4")}"></video>
    </div>
    <div class="pz-desk" data-layer="reception">
      <img class="pz-reception-bg" alt="" src="${ASSET("reception.jpg")}" />
      <div class="pz-reception-dim"></div>
      <canvas id="pz-mascot"></canvas>
    </div>
    <div class="pz-gestures" aria-hidden="true"></div>
    <img class="pz-leela-logo" alt="The Leela" src="${ASSET("leela-logo.png")}" />
    <div class="pz-dock">
      <button class="pz-cue" type="button" aria-label="Enter the Leela">
        <span class="pz-cue-arrow">${ARROW_SVG}</span>
        <span class="pz-cue-label">Enter the Leela</span>
      </button>
    </div>
  `;
  const shell = phoneShell();
  shell.appendChild(root);
  const logo = root.querySelector(".pz-leela-logo");
  const dock = root.querySelector(".pz-dock");
  if (logo) shell.appendChild(logo);
  if (dock) shell.appendChild(dock);
  return root;
}

async function boot() {
  const html = document.documentElement;
  html.classList.add("pz-cinematic", "pz-intro");
  const root = buildDom();
  const cue = document.querySelector(".pz-cue");
  const poster = root.querySelector(".pz-poster");
  const loading = root.querySelector(".pz-loading");
  const videos = [...root.querySelectorAll("video.pz-clip")];
  const reception = root.querySelector("[data-layer='reception']");
  const dock = document.querySelector(".pz-dock");
  const media = root.querySelector(".pz-media");
  const gestures = root.querySelector(".pz-gestures");
  const shell = phoneShell();

  let phase = "intro";
  let mascot = null;
  let warming = false;
  let fadingIn = false;

  const scrubber = createScrubber({
    videos,
    onHalt({ atStart, atSceneThree }) {
      if (phase === "live") return;
      if (atStart) {
        phase = "intro";
        setCue(cue, "Enter the Leela");
      } else if (atSceneThree) {
        phase = "scene3";
        setCue(cue, "Speak with Reception");
      }
    },
    onTime(t, total) {
      if (phase === "live") return;
      if (t >= total - 0.9) enterLive({ seamless: true });
    },
    onComplete() {
      enterLive({ seamless: true });
    },
  });

  async function ensureMascot() {
    if (mascot) {
      mascot.start();
      mascot.resize();
      return;
    }
    try {
      mascot = await createReceptionMascot(document.getElementById("pz-mascot"));
      mascot.start();
      mascot.resize();
      window.__pzMascot = mascot;
    } catch (err) {
      console.warn("Mascot failed to start", err);
    }
  }

  function armNativeCall() {
    if (warming) return;
    warming = true;
    const start = nativeButtons().start;
    start?.click();
  }

  async function enterLive({ seamless } = {}) {
    if (phase === "live" && fadingIn) return;
    if (phase === "live" && reception.classList.contains("is-on")) return;
    fadingIn = true;
    phase = "live";
    hideCue(cue);
    html.classList.remove("pz-intro", "pz-reception", "pz-morphing");
    html.classList.add("pz-live", "pz-handoff");
    root.classList.remove("is-intro");
    reception.classList.add("is-on");
    media.style.opacity = "0";
    media.style.pointerEvents = "none";
    poster.classList.add("is-hidden");
    window.setTimeout(() => {
      html.classList.remove("pz-handoff");
      fadingIn = false;
    }, 900);
    await ensureMascot();
    await waitFor(".demo-mobile-controls");
    document.querySelector(".demo-mobile-scroll")?.scrollTo?.(0, 0);
    alignDock(dock);
    mascot?.resize();
    if (!warming) armNativeCall();
    window.addEventListener("resize", () => {
      alignDock(dock);
      mascot?.resize();
    }, { passive: true });
  }

  function maybeArmFromGesture() {
    const scene3 = scrubber.debug().sceneThreeStart ?? 0;
    if (scrubber.time >= scene3 - 0.25) armNativeCall();
  }

  function goForward() {
    hideCue(cue);
    maybeArmFromGesture();
    scrubber.playForward();
  }

  await scrubber.prepare();
  window.__pzScrub = scrubber;
  loading.hidden = true;
  videos[0].classList.add("is-active");
  window.setTimeout(() => poster.classList.add("is-hidden"), 180);
  setCue(cue, "Enter the Leela");

  const appRoot = await waitFor("#root");
  if (appRoot && appRoot.parentNode !== shell) shell.appendChild(appRoot);

  function isScrubPhase() {
    return phase !== "live";
  }

  function onPointerDown(event) {
    if (!isScrubPhase()) return;
    maybeArmFromGesture();
    scrubber.onPointerDown(event);
  }
  function onPointerMove(event) {
    if (!isScrubPhase()) return;
    scrubber.onPointerMove(event);
    if (scrubber.mode === "dragging") hideCue(cue);
  }
  function onPointerUp(event) {
    if (!isScrubPhase()) return;
    const onCue = Boolean(event.target.closest(".pz-cue"));
    scrubber.onPointerUp(event, { treatTap: true });
    if (onCue) event.preventDefault();
  }

  for (const el of [gestures, root, shell]) {
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", (event) => scrubber.onPointerUp(event));
  }
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  gestures.addEventListener(
    "touchmove",
    (event) => {
      if (isScrubPhase()) event.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener(
    "wheel",
    (event) => {
      if (!isScrubPhase()) return;
      event.preventDefault();
      hideCue(cue);
      scrubber.onWheel(event);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (!isScrubPhase()) return;
    if (event.key === "ArrowUp" || event.key === " " || event.key === "Enter") {
      if (event.target === cue) return;
      event.preventDefault();
      goForward();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrubber.playReverse();
    }
  });

  cue.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    goForward();
  });

  window.setInterval(() => {
    mascot?.setSpeaking(isCallLive() && isAgentSpeaking());
  }, 240);
}

boot().catch((err) => {
  console.error(err);
  document.documentElement.classList.remove("pz-intro");
});
