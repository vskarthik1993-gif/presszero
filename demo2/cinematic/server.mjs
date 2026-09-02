#!/usr/bin/env node
/**
 * Serve the repo statically and proxy Leela voice /api + /ws to production,
 * so /demo2 can start a real greeting off localhost or a Cloudflare tunnel.
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const UPSTREAM = "leela.161-118-187-170.sslip.io";
const PORT = Number(process.env.PORT || 8000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".blob": "application/octet-stream",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on("open", () => {
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=60",
    });
  });
  stream.on("error", () => {
    res.writeHead(404);
    res.end("Not found");
  });
  stream.pipe(res);
}

function proxyWeb(req, res) {
  const headers = { ...req.headers, host: UPSTREAM };
  const p = https.request(
    {
      hostname: UPSTREAM,
      port: 443,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  p.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`upstream: ${err.message}`);
  });
  req.pipe(p);
}

function proxyUpgrade(req, socket, head) {
  const headers = { ...req.headers, host: UPSTREAM };
  const p = https.request({
    hostname: UPSTREAM,
    port: 443,
    path: req.url,
    method: "GET",
    headers,
  });
  p.on("upgrade", (upRes, upSocket, upHead) => {
    const lines = ["HTTP/1.1 101 Switching Protocols"];
    for (const [key, value] of Object.entries(upRes.headers)) {
      if (value == null) continue;
      lines.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upSocket.write(head);
    if (upHead?.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  p.on("error", () => {
    try {
      socket.end();
    } catch {
      /* ignore */
    }
  });
  p.end();
}

function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  if (rel === "/demo2") rel = "/demo2/index.html";
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) return null;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  if (fs.existsSync(`${filePath}.html`) && fs.statSync(`${filePath}.html`).isFile()) {
    return `${filePath}.html`;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url || "/";
  if (urlPath.startsWith("/api/") || urlPath.startsWith("/ws/")) {
    proxyWeb(req, res);
    return;
  }
  const filePath = resolveStatic(urlPath);
  if (!filePath) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  sendFile(req, res, filePath);
});

server.on("upgrade", (req, socket, head) => {
  if ((req.url || "").startsWith("/ws/")) {
    proxyUpgrade(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PressZero demo on http://0.0.0.0:${PORT}/demo2/ (voice → ${UPSTREAM})`);
});
