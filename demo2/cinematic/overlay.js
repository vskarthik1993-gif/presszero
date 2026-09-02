import { createScrubber } from "./scrub.js?v=19";
import { createReceptionMascot } from "./mascot.js?v=19";

const ASSET = (name) => new URL(`./assets/${name}`, import.meta.url).href;

const PHONE_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z"/></svg>`;
const MIC_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
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
  const bottom = Math.max(12, window.innerHeight - rect.bottom);
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
      <div class="pz-reverse-zone" aria-hidden="true"></div>
    </div>
    <img class="pz-leela-logo" alt="The Leela" src="${ASSET("leela-logo.png")}" />
    <div class="pz-dock">
      <button class="pz-cue" type="button" aria-label="Swipe up">
        <span class="pz-cue-arrow">${ARROW_SVG}</span>
        <span class="pz-cue-label">Swipe Up</span>
      </button>
      <button class="pz-speak" type="button" hidden>
        ${PHONE_SVG}
        <span>Speak to the AI Receptionist</span>
      </button>
    </div>
  `;
  const host = document.getElementById("root");
  if (host?.parentNode) host.parentNode.insertBefore(root, host);
  else document.body.appendChild(root);
  const logo = root.querySelector(".pz-leela-logo");
  const dock = root.querySelector(".pz-dock");
  if (logo) document.body.appendChild(logo);
  if (dock) document.body.appendChild(dock);
  return root;
}

async function morphSpeakToControls(speak) {
  const html = document.documentElement;
  const { start, mute, end } = nativeButtons();
  const speakRect = speak.getBoundingClientRect();
  // Live + morphing together so mute/end stay invisible while Speak is still
  // on screen. Never let native start show — that was the 3-button flash.
  html.classList.add("pz-live", "pz-morphing");
  alignDock(document.querySelector(".pz-dock"));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const muteRect = mute?.getBoundingClientRect();
  const endRect = end?.getBoundingClientRect();
  const ghosts = document.createElement("div");
  ghosts.className = "pz-ghosts";
  const mk = (cls, svg, from, to) => {
    const node = document.createElement("div");
    node.className = `pz-ghost ${cls}`;
    node.innerHTML = svg;
    node.style.left = `${from.left + from.width / 2 - 32}px`;
    node.style.top = `${from.top + from.height / 2 - 32}px`;
    ghosts.appendChild(node);
    node.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        {
          transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(1)`,
          opacity: 1,
        },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    );
  };
  if (muteRect && endRect && muteRect.width > 4 && endRect.width > 4) {
    document.body.appendChild(ghosts);
    mk("pz-ghost--mute", MIC_SVG, speakRect, muteRect);
    mk("pz-ghost--end", PHONE_SVG, speakRect, endRect);
  }
  speak.hidden = true;
  speak.classList.add("is-morphing");
  await new Promise((resolve) => window.setTimeout(resolve, 520));
  html.classList.remove("pz-morphing");
  ghosts.remove();
  start?.click();
}

async function boot() {
  const html = document.documentElement;
  html.classList.add("pz-cinematic", "pz-intro");
  const root = buildDom();
  const cue = document.querySelector(".pz-cue");
  const speak = document.querySelector(".pz-speak");
  const poster = root.querySelector(".pz-poster");
  const loading = root.querySelector(".pz-loading");
  const videos = [...root.querySelectorAll("video.pz-clip")];
  const reception = root.querySelector("[data-layer='reception']");
  const dock = document.querySelector(".pz-dock");
  const media = root.querySelector(".pz-media");

  let phase = "scene1";
  let mascot = null;

  const scrubber = createScrubber({
    videos,
    onHalt({ atStart, atSceneTwo }) {
      if (phase === "reception" || phase === "live") return;
      if (atStart) {
        phase = "scene1";
        setCue(cue, "Swipe Up");
      } else if (atSceneTwo) {
        phase = "scene2";
        setCue(cue, "Enter The Leela");
      }
    },
    onComplete() {
      enterReception();
    },
  });

  async function enterReception() {
    if (phase === "reception" || phase === "live") return;
    phase = "reception";
    hideCue(cue);
    html.classList.remove("pz-intro");
    html.classList.add("pz-reception");
    root.classList.remove("is-intro");
    reception.classList.add("is-on");
    media.style.opacity = "0";
    media.style.pointerEvents = "none";
    speak.hidden = false;
    poster.classList.add("is-hidden");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!mascot) {
      try {
        mascot = await createReceptionMascot(document.getElementById("pz-mascot"));
        mascot.start();
        mascot.resize();
        window.__pzMascot = mascot;
      } catch (err) {
        console.warn("Mascot failed to start", err);
      }
    } else {
      mascot.start();
      mascot.resize();
    }
    await waitFor(".demo-mobile-controls");
    alignDock(dock);
    window.addEventListener("resize", () => alignDock(dock), { passive: true });
  }

  function leaveReceptionBackward() {
    if (phase !== "reception") return;
    phase = "scene2";
    html.classList.add("pz-intro");
    html.classList.remove("pz-reception", "pz-live", "pz-morphing");
    root.classList.add("is-intro");
    reception.classList.remove("is-on");
    media.style.opacity = "1";
    media.style.pointerEvents = "";
    speak.hidden = true;
    hideCue(cue);
    scrubber.setTime(Math.max(0, scrubber.total - 0.04));
    scrubber.playReverse();
  }

  await scrubber.prepare();
  window.__pzScrub = scrubber;
  loading.hidden = true;
  videos[0].classList.add("is-active");
  window.setTimeout(() => poster.classList.add("is-hidden"), 180);
  setCue(cue, "Swipe Up");

  const gestureTarget = root;
  gestureTarget.addEventListener("pointerdown", (event) => {
    if (phase === "live") return;
    if (phase === "reception") {
      if (event.target.closest(".pz-speak")) return;
      gestureTarget._recv = {
        y: event.clientY,
        at: performance.now(),
        id: event.pointerId,
      };
      return;
    }
    if (event.target.closest(".pz-cue")) return;
    scrubber.onPointerDown(event);
  });
  gestureTarget.addEventListener("pointermove", (event) => {
    if (phase === "reception" || phase === "live") return;
    scrubber.onPointerMove(event);
    if (scrubber.mode === "dragging") hideCue(cue);
  });
  gestureTarget.addEventListener("pointerup", (event) => {
    if (phase === "live") return;
    if (phase === "reception") {
      const start = gestureTarget._recv;
      gestureTarget._recv = null;
      if (!start) return;
      const dy = event.clientY - start.y;
      if (dy > 48) leaveReceptionBackward();
      return;
    }
    const treatTap = Boolean(event.target.closest(".pz-cue"));
    scrubber.onPointerUp(event, { treatTap: treatTap || undefined });
  });
  gestureTarget.addEventListener("pointercancel", (event) => {
    scrubber.onPointerUp(event);
  });
  gestureTarget.addEventListener(
    "touchmove",
    (event) => {
      if (phase !== "live") event.preventDefault();
    },
    { passive: false },
  );
  gestureTarget.addEventListener(
    "wheel",
    (event) => {
      if (phase === "live") return;
      if (phase === "reception") {
        if (event.deltaY > 24) leaveReceptionBackward();
        return;
      }
      hideCue(cue);
      scrubber.onWheel(event);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (phase === "live") return;
    if (event.key === "ArrowUp" || event.key === " " || event.key === "Enter") {
      if (event.target === speak || event.target === cue) return;
      event.preventDefault();
      if (phase === "reception") speak.click();
      else {
        hideCue(cue);
        scrubber.playForward();
      }
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (phase === "reception") leaveReceptionBackward();
      else scrubber.playReverse();
    }
  });

  cue.addEventListener("click", (event) => {
    event.preventDefault();
    hideCue(cue);
    scrubber.playForward();
  });

  speak.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (phase !== "reception") return;
    phase = "live";
    html.classList.remove("pz-reception");
    html.classList.add("pz-live", "pz-morphing");
    await waitFor(".demo-callbtn--start");
    alignDock(dock);
    await morphSpeakToControls(speak);
    let hadLiveCall = false;
    const watch = () => {
      if (isCallLive()) hadLiveCall = true;
      mascot?.setSpeaking(isCallLive() && isAgentSpeaking());
      if (hadLiveCall && !isCallLive() && phase === "live") {
        phase = "reception";
        html.classList.remove("pz-live", "pz-morphing");
        html.classList.add("pz-reception");
        speak.hidden = false;
        speak.classList.remove("is-morphing");
        hadLiveCall = false;
      }
    };
    window.setInterval(watch, 240);
  });

  await waitFor("#root");
}

boot().catch((err) => {
  console.error(err);
  document.documentElement.classList.remove("pz-intro");
});
