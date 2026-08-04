(() => {
  const PASSCODE = ".";
  const STORAGE_KEY = "pz-admin-unlocked";
  const BACKEND = "https://leela.161-118-187-170.sslip.io";

  function isUnlocked() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setUnlocked() {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (_) {}
  }

  function apiUrl(path) {
    if (!path) return BACKEND;
    return path.startsWith("http") ? path : `${BACKEND}${path}`;
  }

  function requireAuth({ redirectTo = "/admin/call-history/" } = {}) {
    if (isUnlocked()) return true;
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(`/admin/?next=${next || encodeURIComponent(redirectTo)}`);
    return false;
  }

  function renderSidebar(active) {
    const mount = document.getElementById("admin-rail");
    if (!mount) return;
    mount.innerHTML = `
      <a class="admin-brand" href="/admin/call-history/">
        <img src="/assets/presszero-transparent-zero.png" alt="PressZero" />
        <span>
          <strong>PressZero</strong>
          <em>Admin</em>
        </span>
      </a>
      <nav class="admin-nav" aria-label="Admin">
        <div class="admin-nav-label">Console</div>
        <a class="${active === "history" ? "active" : ""}" href="/admin/call-history/" ${active === "history" ? 'aria-current="page"' : ""}>
          <span>Call History</span>
          <b id="admin-call-count">···</b>
        </a>
        <a class="${active === "mascot" ? "active" : ""}" href="/mascot/" ${active === "mascot" ? 'aria-current="page"' : ""}>
          <span>3D Mascot</span>
          <b>/mascot</b>
        </a>
        <a class="${active === "design" ? "active" : ""}" href="/admin/design-system/" ${active === "design" ? 'aria-current="page"' : ""}>
          <span>Design System</span>
          <b>Brand</b>
        </a>
      </nav>
    `;
  }

  async function refreshCallCount() {
    const el = document.getElementById("admin-call-count");
    if (!el) return;
    try {
      const response = await fetch(apiUrl("/api/call-history"));
      const data = await response.json();
      el.textContent = String((data.calls || []).length);
    } catch (_) {
      el.textContent = "—";
    }
  }

  function durationSeconds(call) {
    const start = Date.parse(call?.created_at || "");
    const end = Date.parse(call?.closed_at || "");
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      return Math.round((end - start) / 1000);
    }
    const turns = call?.transcript || [];
    if (turns.length) {
      const first = Date.parse(turns[0]?.started_at || "");
      const last = Date.parse(turns[turns.length - 1]?.ended_at || turns[turns.length - 1]?.started_at || "");
      if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
        return Math.round((last - first) / 1000);
      }
    }
    return 0;
  }

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  window.PressZeroAdmin = {
    PASSCODE,
    BACKEND,
    isUnlocked,
    setUnlocked,
    apiUrl,
    requireAuth,
    renderSidebar,
    refreshCallCount,
    durationSeconds,
    money,
    escapeHtml,
  };
})();
