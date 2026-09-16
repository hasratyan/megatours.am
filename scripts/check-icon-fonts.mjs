import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getIconSourceTokens } from "./icon-source-tokens.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tokens = getIconSourceTokens();
const manifest = JSON.parse(readFileSync(join(root, "assets/fonts/manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "node_modules/material-symbols/package.json"), "utf8"));
if (manifest.packageVersion !== pkg.version) throw new Error("Icon package changed. Regenerate fonts: see docs/performance.md");
for (const [style, font] of Object.entries(manifest.fonts)) {
  const included = new Set(font.includedIcons);
  const missing = font.availableIcons.filter((name) => tokens.has(name) && !included.has(name));
  if (missing.length) throw new Error(`Regenerate ${style} icons (${missing.join(", ")}): see docs/performance.md`);
  const bytes = readFileSync(join(root, `assets/fonts/material-symbols-${style}.woff2`));
  if (createHash("sha256").update(bytes).digest("hex") !== font.sha256) throw new Error(`Invalid ${style} font checksum`);
  console.log(`${style}: ${font.includedIcons.length} icons, ${bytes.length.toLocaleString()} bytes, coverage OK`);
}
