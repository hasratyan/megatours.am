import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getIconSourceTokens } from "./icon-source-tokens.mjs";

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function inspectIconFonts({ root = projectRoot, tokens = getIconSourceTokens() } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "node_modules/material-symbols/package.json"), "utf8"));
  const result = { packageVersion: pkg.version, issues: [], fonts: [] };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "assets/fonts/manifest.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    result.issues.push("Icon font manifest is missing or invalid");
    return result;
  }
  if (manifest?.packageVersion !== pkg.version) {
    result.issues.push(`Material Symbols changed from ${manifest?.packageVersion ?? "unknown"} to ${pkg.version}`);
  }
  for (const style of ["outlined", "rounded"]) {
    const font = manifest?.fonts?.[style];
    if (!Array.isArray(font?.includedIcons) || !Array.isArray(font?.availableIcons)) {
      result.issues.push(`Missing or invalid ${style} font metadata`);
      continue;
    }
    const included = new Set(font.includedIcons);
    const missing = font.availableIcons.filter((name) => tokens.has(name) && !included.has(name));
    if (missing.length) result.issues.push(`Missing ${style} icons: ${missing.join(", ")}`);
    const path = join(root, `assets/fonts/material-symbols-${style}.woff2`);
    if (!existsSync(path)) {
      result.issues.push(`Missing ${style} font file`);
      continue;
    }
    const bytes = readFileSync(path);
    if (createHash("sha256").update(bytes).digest("hex") !== font.sha256) {
      result.issues.push(`Invalid ${style} font checksum`);
    }
    result.fonts.push({ style, count: font.includedIcons.length, bytes: bytes.length });
  }
  for (const file of ["symbols.css", "LICENSE"]) {
    if (!existsSync(join(root, "assets/fonts", file))) result.issues.push(`Missing icon font ${file}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = inspectIconFonts();
    if (result.issues.length) throw new Error(`${result.issues.join("\n")}\nRun npm run icons:ensure to repair generated fonts.`);
    for (const font of result.fonts) {
      console.log(`${font.style}: ${font.count} icons, ${font.bytes.toLocaleString()} bytes, coverage OK`);
    }
  } catch (error) {
    console.error(`[icons] ${error.message}`);
    process.exitCode = 1;
  }
}
