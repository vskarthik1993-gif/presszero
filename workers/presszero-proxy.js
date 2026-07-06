/**
 * PressZero edge proxy
 *
 * Keeps presszero.in/demo and /mascot in the address bar while serving
 * content from the Leela demo and Zero mascot hosts (incl. WebSockets).
 *
 * Deploy with Wrangler and route presszero.in/* to this worker.
 */

const LEELA_ORIGIN = "https://leela.161-118-187-170.sslip.io";
const MASCOT_ORIGIN = "https://vskarthik1993-gif.github.io";
const MASCOT_BASE = "/voice-zero-mascot-demo";

function isDemoPath(pathname) {
  return pathname === "/demo" || pathname.startsWith("/demo/");
}

function isMascotPath(pathname) {
  return pathname === "/mascot" || pathname.startsWith("/mascot/");
}

function isLeelaBackendPath(pathname) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/ws/") ||
    pathname.startsWith("/data/") ||
    pathname.startsWith("/recordings/") ||
    pathname.startsWith("/src/")
  );
}

function isLeelaAssetPath(pathname, request) {
  if (pathname.match(/^\/assets\/index-[^/]+\.(js|css)$/)) return true;
  if (pathname === "/assets/mascot/bold.blob") {
    const referer = request.headers.get("Referer") || "";
    return referer.includes("/demo");
  }
  return false;
}

function leelaTargetUrl(request) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname === "/demo/") pathname = "/demo";
  return new URL(pathname + url.search, LEELA_ORIGIN);
}

function mascotTargetUrl(request) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname === "/mascot" || pathname === "/mascot/") {
    pathname = `${MASCOT_BASE}/`;
  } else if (pathname.startsWith("/mascot/")) {
    pathname = `${MASCOT_BASE}${pathname.slice("/mascot".length)}`;
  }
  return new URL(pathname + url.search, MASCOT_ORIGIN);
}

function rewriteMascotBody(body, contentType) {
  if (!contentType) return body;
  if (
    contentType.includes("text/html") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("text/css")
  ) {
    return body.replaceAll(`${MASCOT_BASE}/`, "/mascot/").replaceAll(MASCOT_BASE, "/mascot");
  }
  return body;
}

async function proxyRequest(request, targetUrl, { rewriteMascot = false } = {}) {
  const headers = new Headers(request.headers);
  headers.set("Host", targetUrl.host);
  headers.delete("cf-connecting-ip");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(targetUrl.toString(), init);

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("Location");
    if (location) {
      const redirectUrl = new URL(location, targetUrl);
      if (redirectUrl.origin === targetUrl.origin) {
        const local = new URL(request.url);
        local.pathname = redirectUrl.pathname;
        local.search = redirectUrl.search;
        return Response.redirect(local.toString(), upstream.status);
      }
    }
  }

  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return upstream;
  }

  const contentType = upstream.headers.get("content-type") || "";
  if (!rewriteMascot) {
    return upstream;
  }

  const body = await upstream.text();
  const rewritten = rewriteMascotBody(body, contentType);
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("content-length");
  return new Response(rewritten, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    // /demo and /mascot are self-hosted from GitHub Pages (see demo/ and mascot/ in repo).
    // API + WebSocket still proxy to Leela below.

    if (isLeelaBackendPath(pathname) || isLeelaAssetPath(pathname, request)) {
      return proxyRequest(request, new URL(pathname + url.search, LEELA_ORIGIN));
    }

    return fetch(request);
  },
};
