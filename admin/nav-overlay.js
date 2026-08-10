/**
 * PressZero admin nav overlay for fullscreen pages (mascot, design system canvas).
 * Shows a top-left hamburger that opens the same admin sidebar.
 * Visible when the admin session is unlocked (sessionStorage).
 */
(() => {
  const STORAGE_KEY = "pz-admin-unlocked";
  const BACKEND = "https://leela.161-118-187-170.sslip.io";
  const STYLE_ID = "pz-admin-overlay-style";
  const ROOT_ID = "pz-admin-overlay";

  function isUnlocked() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function detectActive() {
    const path = location.pathname || "";
    if (path.startsWith("/admin/call-history")) return "history";
    if (path.startsWith("/admin/design")) return "design";
    if (path.startsWith("/admin/mascot")) return "mascot";
    return "";
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} { all: initial; font-family: "Open Sans", system-ui, sans-serif; }
      #${ROOT_ID} * { box-sizing: border-box; }
      #${ROOT_ID} .pz-burger {
        position: fixed; top: 14px; left: 14px; z-index: 2147483000;
        width: 42px; height: 42px; border-radius: 11px;
        border: 1px solid rgba(237,164,92,0.28);
        background: rgba(11,11,13,0.78);
        color: #f5f3ef; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        box-shadow: 0 10px 28px rgba(0,0,0,0.35);
        transition: border-color .2s ease, background .2s ease, transform .2s ease;
      }
      #${ROOT_ID} .pz-burger:hover {
        border-color: rgba(237,164,92,0.55);
        background: rgba(20,16,12,0.92);
        transform: translateY(-1px);
      }
      #${ROOT_ID} .pz-burger:focus-visible {
        outline: 2px solid rgba(237,164,92,0.55); outline-offset: 2px;
      }
      #${ROOT_ID} .pz-burger svg { display: block; }
      #${ROOT_ID} .pz-scrim {
        position: fixed; inset: 0; z-index: 2147483001;
        background: rgba(0,0,0,0.48);
        opacity: 0; pointer-events: none;
        transition: opacity .22s ease;
      }
      #${ROOT_ID}.is-open .pz-scrim { opacity: 1; pointer-events: auto; }
      #${ROOT_ID} .pz-drawer {
        position: fixed; top: 0; left: 0; bottom: 0; z-index: 2147483002;
        width: min(280px, calc(100vw - 48px));
        padding: 28px 18px;
        background: rgba(11,11,13,0.96);
        border-right: 1px solid rgba(255,255,255,0.08);
        box-shadow: 18px 0 50px rgba(0,0,0,0.45);
        transform: translateX(-104%);
        transition: transform .24s ease;
        display: flex; flex-direction: column; gap: 28px;
        color: #f5f3ef;
      }
      #${ROOT_ID}.is-open .pz-drawer { transform: translateX(0); }
      #${ROOT_ID} .pz-brand {
        display: flex; align-items: center; gap: 12px;
        color: inherit; text-decoration: none;
      }
      #${ROOT_ID} .pz-brand img {
        width: 36px; height: 36px; object-fit: contain;
        filter: drop-shadow(0 8px 18px rgba(0,0,0,0.45));
      }
      #${ROOT_ID} .pz-brand strong { display: block; font-weight: 600; letter-spacing: .02em; }
      #${ROOT_ID} .pz-brand em {
        display: block; font-style: normal; font-size: 12px;
        color: #8a847c; letter-spacing: .14em; text-transform: uppercase;
      }
      #${ROOT_ID} .pz-nav { display: grid; gap: 8px; }
      #${ROOT_ID} .pz-nav-label {
        font-size: 11px; letter-spacing: .22em; text-transform: uppercase;
        color: #8a847c; margin: 0 0 4px 10px;
      }
      #${ROOT_ID} .pz-nav a {
        display: flex; justify-content: space-between; align-items: center; gap: 12px;
        padding: 12px 14px; border-radius: 10px;
        color: #d7d1c8; text-decoration: none;
        border: 1px solid transparent;
        transition: background .2s ease, border-color .2s ease, color .2s ease;
      }
      #${ROOT_ID} .pz-nav a:hover {
        background: rgba(237,164,92,0.08); color: #f5f3ef;
      }
      #${ROOT_ID} .pz-nav a.active {
        background: linear-gradient(180deg, rgba(237,164,92,0.16), rgba(237,164,92,0.06));
        border-color: rgba(237,164,92,0.28); color: #f5f3ef;
      }
      #${ROOT_ID} .pz-nav a b {
        font-size: 11px; font-weight: 600; letter-spacing: .08em;
        text-transform: uppercase; color: #8a847c;
      }
      #${ROOT_ID} .pz-close {
        appearance: none; border: 0; background: transparent;
        color: #8a847c; cursor: pointer; align-self: flex-end;
        font-size: 13px; letter-spacing: .12em; text-transform: uppercase;
        padding: 6px 4px;
      }
      #${ROOT_ID} .pz-close:hover { color: #f5f3ef; }
      @media (prefers-reduced-motion: reduce) {
        #${ROOT_ID} .pz-burger,
        #${ROOT_ID} .pz-scrim,
        #${ROOT_ID} .pz-drawer { transition: none; }
      }
      /* Leave room for the burger left of the mascot top bar title */
      body:has(#${ROOT_ID}) .voice-demo__header {
        padding-left: 4.25rem !important;
      }
    `;
    document.head.appendChild(style);
  }

  function mount() {
    if (!isUnlocked()) return;
    if (document.getElementById(ROOT_ID)) return;
    injectStyles();

    const active = detectActive();
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <button type="button" class="pz-burger" aria-label="Open admin navigation" aria-expanded="false" aria-controls="pz-admin-drawer">
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
          <path d="M1 1h16M1 7h16M1 13h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="pz-scrim" data-close></div>
      <aside class="pz-drawer" id="pz-admin-drawer" role="dialog" aria-modal="true" aria-label="Admin navigation">
        <button type="button" class="pz-close" data-close>Close</button>
        <a class="pz-brand" href="/admin/call-history/">
          <img src="/assets/presszero-transparent-zero.png" alt="" />
          <span>
            <strong>PressZero</strong>
            <em>Admin</em>
          </span>
        </a>
        <nav class="pz-nav" aria-label="Admin">
          <div class="pz-nav-label">Console</div>
          <a class="${active === "history" ? "active" : ""}" href="/admin/call-history/" ${active === "history" ? 'aria-current="page"' : ""}>
            <span>Call History</span>
            <b id="pz-overlay-call-count">···</b>
          </a>
          <a class="${active === "mascot" ? "active" : ""}" href="/admin/mascot/" ${active === "mascot" ? 'aria-current="page"' : ""}>
            <span>3D Mascot</span>
            <b>3D</b>
          </a>
          <a class="${active === "design" ? "active" : ""}" href="/admin/design/" ${active === "design" ? 'aria-current="page"' : ""}>
            <span>Design System</span>
            <b>Brand</b>
          </a>
        </nav>
      </aside>
    `;
    document.body.appendChild(root);

    const burger = root.querySelector(".pz-burger");
    const setOpen = (open) => {
      root.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.style.overflow = open ? "hidden" : "";
    };

    burger.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
    root.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => setOpen(false));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    fetch(`${BACKEND}/api/call-history?limit=0`)
      .then((r) => r.json())
      .then((data) => {
        const el = document.getElementById("pz-overlay-call-count");
        if (!el) return;
        const total = Number(data.total);
        el.textContent = String(Number.isFinite(total) ? total : (data.calls || []).length);
      })
      .catch(() => {
        const el = document.getElementById("pz-overlay-call-count");
        if (el) el.textContent = "—";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
