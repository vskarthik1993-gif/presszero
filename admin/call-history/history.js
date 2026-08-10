(() => {
  const {
    requireAuth,
    renderSidebar,
    refreshCallCount,
    apiUrl,
    durationSeconds,
    money,
    escapeHtml,
  } = window.PressZeroAdmin;

  if (!requireAuth()) return;
  renderSidebar("history");
  refreshCallCount();

  const PAGE_SIZE = 50;
  const listEl = document.getElementById("call-list");
  const metaEl = document.getElementById("list-meta");
  const detailEl = document.getElementById("call-detail");
  const hideShortEl = document.getElementById("hide-short");
  const loadMoreWrap = document.getElementById("load-more-wrap");
  const loadMoreBtn = document.getElementById("load-more");

  let allCalls = [];
  let selectedSlug = "";
  let totalCalls = 0;
  let hasMore = false;
  let loading = false;

  function visibleCalls() {
    if (!hideShortEl.checked) return allCalls;
    return allCalls.filter((call) => durationSeconds(call) >= 30);
  }

  function updateLoadMore() {
    if (!loadMoreWrap || !loadMoreBtn) return;
    loadMoreWrap.hidden = !hasMore;
    loadMoreBtn.disabled = loading;
    loadMoreBtn.textContent = loading ? "Loading…" : "Load more";
  }

  function renderList() {
    const calls = visibleCalls();
    const loaded = allCalls.length;
    if (totalCalls > loaded) {
      metaEl.textContent = `${calls.length} shown · ${loaded} of ${totalCalls} loaded`;
    } else {
      metaEl.textContent = `${calls.length} records`;
    }

    updateLoadMore();

    if (!calls.length) {
      listEl.innerHTML = `<div class="empty-state">No saved calls match the current filter.</div>`;
      return;
    }

    if (!calls.some((call) => call.slug === selectedSlug)) {
      selectedSlug = calls[0].slug;
    }

    listEl.innerHTML = calls
      .map((call) => {
        const selected = call.slug === selectedSlug ? "selected" : "";
        return `
          <button type="button" class="history-card ${selected}" data-slug="${escapeHtml(call.slug)}">
            <span class="small-label">${escapeHtml(call.session_id || "manual record")}</span>
            <strong>${escapeHtml(call.title || call.slug)}</strong>
            <span>${call.created_at ? escapeHtml(new Date(call.created_at).toLocaleString()) : "Saved call"}</span>
            <div>
              <b>${durationSeconds(call)}s</b>
              <b>${(call.transcript || []).length} turns</b>
              <b>${(call.payment_links || []).length} links</b>
              <b>${(call.recordings || []).length ? "Recording" : "No audio"}</b>
            </div>
          </button>
        `;
      })
      .join("");

    listEl.querySelectorAll("[data-slug]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedSlug = button.getAttribute("data-slug");
        renderList();
        renderDetail();
      });
    });
  }

  function quoteHtml(call) {
    const quote = call.quote;
    const payment = (call.payment_links || [])[0];
    if (quote?.selected_room) {
      const guests = (quote.guest?.adults || 0) + (quote.guest?.children || 0);
      return `
        <div class="quote-card">
          ${quote.selected_room.image_url ? `<img src="${escapeHtml(quote.selected_room.image_url)}" alt="" />` : ""}
          <span>${escapeHtml(quote.stay?.check_in || "—")} to ${escapeHtml(quote.stay?.check_out || "—")}</span>
          <h4>${escapeHtml(quote.selected_room.room_name || "Quote")}</h4>
          <p>${escapeHtml(quote.selected_room.description || "")}</p>
          <div class="call-facts" style="padding:0;grid-template-columns:repeat(3,1fr)">
            <div class="metric"><span>Guests</span><strong>${guests}</strong></div>
            <div class="metric"><span>Total</span><strong>${escapeHtml(money(quote.totals?.total_inr))}</strong></div>
            <div class="metric"><span>Quote</span><strong>${escapeHtml(quote.quote_id || "—")}</strong></div>
          </div>
          ${quote.payment?.payment_link ? `<a href="${escapeHtml(quote.payment.payment_link)}" target="_blank" rel="noreferrer">Open payment link</a>` : ""}
        </div>
      `;
    }
    if (payment?.url) {
      return `<div class="quote-card"><a href="${escapeHtml(payment.url)}" target="_blank" rel="noreferrer">Open quote / payment link</a></div>`;
    }
    return `<div class="empty-state">No payment link was attached to this call.</div>`;
  }

  function transcriptHtml(call) {
    const turns = (call.transcript || []).filter((turn) => turn?.text);
    if (!turns.length) return `<div class="empty-state">No transcript saved.</div>`;
    return `
      <div class="transcript-feed">
        ${turns
          .map((turn) => {
            const role = String(turn.role || "turn").toLowerCase();
            const when = turn.started_at ? new Date(turn.started_at).toLocaleTimeString() : "";
            return `
              <article class="turn ${escapeHtml(role)}">
                <header>
                  <span>${escapeHtml(role)}</span>
                  <span>${escapeHtml(when)}</span>
                </header>
                <p>${escapeHtml(turn.text)}</p>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderDetail() {
    const call = visibleCalls().find((item) => item.slug === selectedSlug) || null;
    if (!call) {
      detailEl.innerHTML = `<div class="panel empty-state">Select a saved call to review.</div>`;
      return;
    }

    const recordingUrl = call.recordings?.length
      ? apiUrl(`/api/call-history/${encodeURIComponent(call.slug)}/recording`)
      : "";

    detailEl.innerHTML = `
      <div class="history-detail-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>${escapeHtml(call.title || call.slug)}</h3>
            <span>${escapeHtml(call.closed_at ? "Closed" : call.status || "Saved")}</span>
          </div>
          <div class="call-facts">
            <div class="metric"><span>Session</span><strong>${escapeHtml(call.session_id || call.slug)}</strong></div>
            <div class="metric"><span>Voice</span><strong>${escapeHtml(call.voice || "—")}</strong></div>
            <div class="metric"><span>Model</span><strong>${escapeHtml(call.model || "—")}</strong></div>
            <div class="metric"><span>Created</span><strong>${call.created_at ? escapeHtml(new Date(call.created_at).toLocaleString()) : "Saved"}</strong></div>
          </div>
          ${quoteHtml(call)}
          ${
            recordingUrl
              ? `<div class="player-bar">
                  <audio controls preload="metadata" src="${escapeHtml(recordingUrl)}"></audio>
                  <a href="${escapeHtml(recordingUrl)}" download>Download stereo</a>
                </div>`
              : `<div class="empty-state">No unified recording available.</div>`
          }
        </section>
        <section class="panel transcript-panel">
          <div class="panel-head">
            <h3>Transcript</h3>
            <span>${(call.transcript || []).length} turns</span>
          </div>
          ${transcriptHtml(call)}
        </section>
      </div>
    `;
  }

  hideShortEl.addEventListener("change", () => {
    renderList();
    renderDetail();
  });

  async function fetchPage(offset) {
    const response = await fetch(
      apiUrl(`/api/call-history?limit=${PAGE_SIZE}&offset=${offset}`)
    );
    if (!response.ok) throw new Error("Failed to load call history");
    return response.json();
  }

  async function load({ append = false } = {}) {
    if (loading) return;
    loading = true;
    updateLoadMore();
    if (!append) metaEl.textContent = "Loading";

    try {
      const offset = append ? allCalls.length : 0;
      const data = await fetchPage(offset);
      const nextCalls = data.calls || [];
      totalCalls = Number(data.total) || nextCalls.length;
      hasMore = Boolean(data.has_more);
      allCalls = append ? allCalls.concat(nextCalls) : nextCalls;
      renderList();
      renderDetail();
      refreshCallCount();
    } catch (_) {
      if (!append) {
        metaEl.textContent = "Failed";
        listEl.innerHTML = `<div class="empty-state">Could not load call history from Leela.</div>`;
        hasMore = false;
        updateLoadMore();
      } else {
        metaEl.textContent = "Failed to load more";
      }
    } finally {
      loading = false;
      updateLoadMore();
    }
  }

  loadMoreBtn?.addEventListener("click", () => {
    if (!hasMore || loading) return;
    load({ append: true });
  });

  load();
})();
