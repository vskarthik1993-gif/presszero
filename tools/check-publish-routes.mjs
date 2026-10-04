import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const routes = JSON.parse(
  await readFile(resolve(root, "site-routes.json"), "utf8"),
);
const cname = (await readFile(resolve(root, "CNAME"), "utf8")).trim();
if (cname !== routes.site)
  throw new Error(`CNAME is ${cname}; route manifest expects ${routes.site}.`);

const required = [
  { path: "/", entry: routes.sharedEntry, product: "Shared PressZero shell" },
  ...routes.routes,
];
const missing = [];
for (const route of required) {
  try {
    await access(resolve(root, route.entry), constants.R_OK);
  } catch {
    missing.push(`${route.path} (${route.product}; expected ${route.entry})`);
  }
}
if (missing.length)
  throw new Error(`Refusing to publish; required routes are missing:\n- ${missing.join("\n- ")}`);

console.log(`Publish route check passed for ${required.length} routes on ${routes.site}.`);
