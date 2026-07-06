import { createRequire } from "module";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("/Users/karthikvijapurapu/projects/Hotel Reception/node_modules/playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const hotelRoot = "/Users/karthikvijapurapu/projects/Hotel Reception";
const outPng = path.join(root, "assets", "presszero-mascot.png");

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".blob")) return "application/json";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let filePath;
  if (url.pathname.startsWith("/three/")) {
    filePath = path.join(hotelRoot, "node_modules", url.pathname.slice(1));
  } else {
    filePath = path.join(root, decodeURIComponent(url.pathname.replace(/^\//, "")));
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto(`http://127.0.0.1:${port}/tools/render-mascot.html`);
await page.waitForFunction(() => window.__MASCOT_READY__ || window.__MASCOT_ERROR__, null, { timeout: 30000 });
const err = await page.evaluate(() => window.__MASCOT_ERROR__);
if (err) throw new Error(err);
await page.locator("canvas").screenshot({ path: outPng, omitBackground: true });
await browser.close();
server.close();
console.log(`Wrote ${outPng}`);
