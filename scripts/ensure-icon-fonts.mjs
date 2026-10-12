import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectIconFonts, projectRoot } from "./check-icon-fonts.mjs";
import { getIconSourceTokens } from "./icon-source-tokens.mjs";

function run(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ICON_FONTS_NODE: process.execPath },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Icon font generation failed: ${command} ${args.join(" ")}. ${result.error?.message ?? `Exit ${result.status}`}`);
  }
}

function regenerateIconFonts(root) {
  const environment = join(root, "node_modules/.cache/icon-fonts/venv");
  const python = join(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const requirements = join(root, "scripts/icon-fonts-requirements.txt");
  const version = readFileSync(requirements, "utf8").trim().split("==")[1];
  const ready = spawnSync(python, ["-c", "import sys, fontTools; from fontTools.ttLib.woff2 import haveBrotli; assert fontTools.__version__ == sys.argv[1] and haveBrotli", version]);
  if (ready.error || ready.status !== 0) {
    console.log("[icons] Preparing isolated Python font tools (cached for later regenerations)...");
    const interpreter = process.env.ICON_FONTS_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const available = spawnSync(interpreter, ["--version"]);
    if (available.error || available.status !== 0) {
      throw new Error("Automatic font regeneration needs Python 3 with venv support. Install it or set ICON_FONTS_PYTHON to its executable path.");
    }
    run(interpreter, ["-m", "venv", environment], root);
    run(python, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "-r", requirements], root);
  }
  run(python, [join(root, "scripts/build-icon-fonts.py")], root);
}

export function ensureIconFonts({ root = projectRoot, tokens = getIconSourceTokens(), regenerate = regenerateIconFonts, log = console.log } = {}) {
  const before = inspectIconFonts({ root, tokens });
  if (!before.issues.length) return { regenerated: false };
  log(`[icons] ${before.issues.join("; ")}. Regenerating automatically...`);
  regenerate(root);
  const after = inspectIconFonts({ root, tokens });
  if (after.issues.length) throw new Error(`Generated icon fonts failed validation:\n${after.issues.join("\n")}`);
  log(`[icons] Fonts regenerated and verified for Material Symbols ${after.packageVersion}.`);
  return { regenerated: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    ensureIconFonts();
  } catch (error) {
    console.error(`[icons] ${error.message}`);
    process.exitCode = 1;
  }
}
