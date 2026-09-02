/**
 * Optional reception still + frosted sheen for the original Voice Concierge
 * mascot page. Drives uniforms on the existing SceneBackdrop; does not
 * replace mascot lights, materials, or animations.
 */
(() => {
  const STORAGE = "voice-demo-lobby";
  const PANEL_KEY = "voice-demo-panel-lobby";
  const DEFAULTS = {
    on: false,
    sheen: true,
    zoom: 1.08,
    shiftY: 0.02,
    sheenX: 50,
    sheenY: 44,
    sheenW: 86,
    sheenH: 62,
    frost: 64,
    opacity: 72,
    soft: 30,
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }

  const state = loadState();
  window.__pzLobby = state;

  function row(label, id, min, max, step, value, suffix) {
    return `
      <label class="voice-demo__glow-control voice-demo__glow-control--panel pz-lobby-row">
        <span class="voice-demo__glow-label">${label}</span>
        <input id="${id}" type="range" class="voice-demo__glow-slider voice-demo__glow-slider--wide" min="${min}" max="${max}" step="${step}" value="${value}" />
        <span class="voice-demo__glow-value" id="${id}Out">${suffix(value)}</span>
      </label>`;
  }

  function renderPanel() {
    return `
      <aside class="voice-demo__dock-panel pz-lobby-panel" id="pz-lobby-panel">
        <div class="voice-demo__dock-head">
          <div class="voice-demo__dock-head-copy">
            <h2 class="voice-demo__dock-title">Reception still</h2>
            <p class="voice-demo__dock-sub">Optional lobby plate behind the 0. Off by default — original canvas stays until you pull this lever. Lights and materials on the mascot are unchanged.</p>
          </div>
          <div class="voice-demo__dock-head-actions">
            <button type="button" class="voice-demo__inspect-toggle${state.on ? " is-on" : ""}" id="pz-lobby-toggle" aria-pressed="${state.on}">${state.on ? "On" : "Off"}</button>
            <button type="button" class="voice-demo__dock-minimize" id="pz-lobby-min" aria-label="Minimise Reception still" title="Minimise">−</button>
          </div>
        </div>
        <div class="voice-demo__dock-body" id="pz-lobby-body">
          ${row("Frame zoom", "pz-lobby-zoom", 70, 160, 1, Math.round(state.zoom * 100), (v) => `${(v / 100).toFixed(2)}×`)}
          ${row("Frame lift", "pz-lobby-shift", -30, 30, 1, Math.round(state.shiftY * 100), (v) => `${v}`)}
          <label class="pz-lobby-check"><input id="pz-lobby-sheen" type="checkbox" ${state.sheen ? "checked" : ""} /> Frosted sheen</label>
          <p class="pz-lobby-hint">Sheen sits in front of the still, behind the 0. Resize it to knock the lobby out of focus.</p>
          ${row("Sheen width", "pz-lobby-w", 20, 140, 1, state.sheenW, (v) => `${v}%`)}
          ${row("Sheen height", "pz-lobby-h", 20, 140, 1, state.sheenH, (v) => `${v}%`)}
          ${row("Sheen X", "pz-lobby-x", 10, 90, 1, state.sheenX, (v) => `${v}`)}
          ${row("Sheen Y", "pz-lobby-y", 10, 90, 1, state.sheenY, (v) => `${v}`)}
          ${row("Frost", "pz-lobby-frost", 0, 100, 1, state.frost, (v) => `${v}%`)}
          ${row("Sheen opacity", "pz-lobby-op", 0, 100, 1, state.opacity, (v) => `${v}%`)}
          ${row("Soft edge", "pz-lobby-soft", 4, 60, 1, state.soft, (v) => `${v}%`)}
        </div>
      </aside>`;
  }

  function fmt(id, value) {
    const out = document.getElementById(`${id}Out`);
    if (!out) return;
    if (id === "pz-lobby-zoom") out.textContent = `${(value / 100).toFixed(2)}×`;
    else if (id === "pz-lobby-shift") out.textContent = String(value);
    else if (id === "pz-lobby-x" || id === "pz-lobby-y") out.textContent = String(value);
    else out.textContent = `${value}%`;
  }

  function applyDom() {
    const viewport = document.querySelector(".voice-demo-viewport");
    viewport?.classList.toggle("is-lobby", Boolean(state.on));
    const shield = document.querySelector(".voice-demo__footer-shield");
    if (shield) shield.style.opacity = state.on ? "0" : "";
    const body = document.getElementById("pz-lobby-body");
    if (body) {
      body.hidden = !state.on;
      body.style.display = state.on ? "flex" : "none";
    }
    document.getElementById("pz-lobby-panel")?.classList.toggle("is-off", !state.on);
    const toggle = document.getElementById("pz-lobby-toggle");
    if (toggle) {
      toggle.classList.toggle("is-on", state.on);
      toggle.textContent = state.on ? "On" : "Off";
      toggle.setAttribute("aria-pressed", String(state.on));
    }
    window.__pzLobby = state;
    saveState(state);
  }

  function bind() {
    const $ = (id) => document.getElementById(id);
    $("pz-lobby-toggle")?.addEventListener("click", () => {
      state.on = !state.on;
      applyDom();
    });
    $("pz-lobby-sheen")?.addEventListener("change", (e) => {
      state.sheen = e.target.checked;
      applyDom();
    });
    const map = [
      ["pz-lobby-zoom", (v) => { state.zoom = v / 100; }],
      ["pz-lobby-shift", (v) => { state.shiftY = v / 100; }],
      ["pz-lobby-w", (v) => { state.sheenW = v; }],
      ["pz-lobby-h", (v) => { state.sheenH = v; }],
      ["pz-lobby-x", (v) => { state.sheenX = v; }],
      ["pz-lobby-y", (v) => { state.sheenY = v; }],
      ["pz-lobby-frost", (v) => { state.frost = v; }],
      ["pz-lobby-op", (v) => { state.opacity = v; }],
      ["pz-lobby-soft", (v) => { state.soft = v; }],
    ];
    for (const [id, write] of map) {
      const el = $(id);
      if (!el) continue;
      const onInput = () => {
        const v = Number(el.value);
        write(v);
        fmt(id, v);
        applyDom();
      };
      el.addEventListener("input", onInput);
      el.addEventListener("change", onInput);
    }
    $("pz-lobby-min")?.addEventListener("click", () => {
      localStorage.setItem(PANEL_KEY, "1");
      mount({ collapsed: true });
    });
  }

  function mount({ collapsed } = {}) {
    document.getElementById("pz-lobby-panel")?.remove();
    document.getElementById("pz-lobby-tab")?.remove();
    const isCollapsed = collapsed ?? localStorage.getItem(PANEL_KEY) === "1";
    if (isCollapsed) {
      const tabs = document.querySelector(".voice-demo__dock-tabs--left");
      if (!tabs) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "pz-lobby-tab";
      btn.className = "voice-demo__dock-tab voice-demo__dock-tab--left";
      btn.title = "Expand Reception still";
      btn.innerHTML = '<span class="voice-demo__dock-tab-label">Lobby</span>';
      btn.addEventListener("click", () => {
        localStorage.setItem(PANEL_KEY, "0");
        mount({ collapsed: false });
      });
      tabs.appendChild(btn);
      applyDom();
      return;
    }
    const stack = document.querySelector(".voice-demo__left-stack");
    if (!stack) return;
    stack.insertAdjacentHTML("afterbegin", renderPanel());
    bind();
    applyDom();
  }

  function wait() {
    if (document.querySelector(".voice-demo__left-stack")) {
      mount();
      return;
    }
    const obs = new MutationObserver(() => {
      if (document.querySelector(".voice-demo__left-stack")) {
        obs.disconnect();
        mount();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wait);
  } else {
    wait();
  }
})();
