import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const canonical = await readFile(resolve(root, "index.html"), "utf8");
const sharedMetaNames = new Set([
  "og:title",
  "og:description",
  "og:image",
  "og:image:secure_url",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
]);
const metaTags = [...canonical.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => tag);
const sharedMeta = metaTags.filter((tag) => {
  const property = /\bproperty=["']([^"']+)["']/i.exec(tag)?.[1];
  const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1];
  return sharedMetaNames.has(property || name);
});
const iconTags = [...canonical.matchAll(/<link\b[^>]*>/gi)]
  .map(([tag]) => tag)
  .filter((tag) => /\brel=["'](?:icon|shortcut icon|apple-touch-icon)["']/i.test(tag));
if (!sharedMeta.length || !iconTags.length)
  throw new Error("Root index.html must define shared social metadata and brand icons.");

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name.endsWith(".html")) await normalize(path);
  }
}

async function normalize(path) {
  if (resolve(path) === resolve(root, "index.html")) return;
  let html = await readFile(path, "utf8");
  const keys = new Set();
  html = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    const property = /\bproperty=["']([^"']+)["']/i.exec(tag)?.[1];
    const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1];
    const key = property || name;
    if (!sharedMetaNames.has(key)) return tag;
    if (keys.has(key)) return "";
    keys.add(key);
    return sharedMeta.find((shared) => {
      const sharedProperty = /\bproperty=["']([^"']+)["']/i.exec(shared)?.[1];
      const sharedName = /\bname=["']([^"']+)["']/i.exec(shared)?.[1];
      return (sharedProperty || sharedName) === key;
    }) || tag;
  });
  for (const tag of sharedMeta) {
    const property = /\bproperty=["']([^"']+)["']/i.exec(tag)?.[1];
    const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!keys.has(property || name)) html = html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  }
  html = html.replace(/<link\b[^>]*\brel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi, "");
  html = html.replace(/<\/head>/i, `${iconTags.map((tag) => `  ${tag}`).join("\n")}\n</head>`);
  html = html.replace(/[\t ]+$/gm, "");
  await writeFile(path, html);
}

await walk(root);
console.log(`Synchronized shared PressZero metadata and icons across HTML entrypoints.`);
