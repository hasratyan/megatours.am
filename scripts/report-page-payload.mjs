import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

// Read production artifacts; no running server, database, or supplier is needed.
// Include HTML because server-provided translations move bytes out of JavaScript
// and into the React payload embedded in the document.
const routes = process.argv.slice(2);
if (!routes.length) routes.push("hy", "en", "ru");
const measure = bytes => ({ raw: bytes.length, gzip: gzipSync(bytes).length });
const sum = assets => assets.reduce((total, asset) => ({ raw: total.raw + asset.raw, gzip: total.gzip + asset.gzip }), { raw: 0, gzip: 0 });
const report = {};
for (const route of routes) {
  const filename = path.resolve(".next/server/app", `${route.replace(/^\//, "")}.html`);
  if (!filename.startsWith(path.resolve(".next/server/app") + path.sep) || !existsSync(filename)) {
    throw new Error(`No prerendered document for ${route}. Run npm run build first; dynamic routes require a browser measurement.`);
  }
  const html = readFileSync(filename, "utf8");
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))"/g)].map(match => match[1]))];
  const assets = urls.map(url => ({ url, ...measure(readFileSync(path.join(".next", url.slice(7)))) }));
  const document = measure(Buffer.from(html));
  report[route] = {
    html: document,
    js: sum(assets.filter(asset => asset.url.endsWith(".js"))),
    css: sum(assets.filter(asset => asset.url.endsWith(".css"))),
    total: sum([document, ...assets]),
    assets,
  };
}
console.log(JSON.stringify(report, null, 2));
