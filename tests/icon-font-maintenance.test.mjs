import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectIconFonts } from "../scripts/check-icon-fonts.mjs";
import { ensureIconFonts } from "../scripts/ensure-icon-fonts.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "megatours-icon-fonts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "assets/fonts");
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(root, "node_modules/material-symbols"), { recursive: true });
  writeFileSync(join(root, "node_modules/material-symbols/package.json"), JSON.stringify({ version: "0.48.0" }));
  const generate = (packageVersion = "0.48.0", icons = ["home"]) => {
    const manifest = { packageVersion, fonts: {} };
    for (const style of ["outlined", "rounded"]) {
      const bytes = Buffer.from(`${style}: ${icons.join(", ")}`);
      writeFileSync(join(directory, `material-symbols-${style}.woff2`), bytes);
      manifest.fonts[style] = {
        includedIcons: icons, availableIcons: ["home", "menu"],
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "symbols.css"), "generated CSS");
    writeFileSync(join(directory, "LICENSE"), "font license");
  };
  generate();
  return { root, directory, generate };
}

const tokens = new Set(["home"]);
const log = () => {};

test("valid fonts need no regeneration or Python environment", (t) => {
  const { root } = fixture(t);
  // This fixture has no generator script or Python environment at all.
  assert.deepEqual(ensureIconFonts({ root, tokens, log }), { regenerated: false });
  assert.deepEqual(inspectIconFonts({ root, tokens }).issues, []);
});

test("a package upgrade is repaired once and the next build reuses the fonts", (t) => {
  const { root, generate } = fixture(t);
  generate("0.47.6");
  assert.match(inspectIconFonts({ root, tokens }).issues[0], /0\.47\.6 to 0\.48\.0/);
  let repairs = 0;
  const options = { root, tokens, log, regenerate: () => { repairs++; generate(); } };
  assert.deepEqual(ensureIconFonts(options), { regenerated: true });
  assert.deepEqual(ensureIconFonts(options), { regenerated: false });
  assert.equal(repairs, 1);
});

test("adding an available icon repairs coverage in both font styles", (t) => {
  const { root, generate } = fixture(t);
  const expanded = new Set(["home", "menu"]);
  const before = inspectIconFonts({ root, tokens: expanded });
  assert.deepEqual(before.issues, ["Missing outlined icons: menu", "Missing rounded icons: menu"]);
  ensureIconFonts({ root, tokens: expanded, log, regenerate: () => generate("0.48.0", ["home", "menu"]) });
  assert.deepEqual(inspectIconFonts({ root, tokens: expanded }).issues, []);
});

test("checksum corruption is repaired without relaxing the strict check", (t) => {
  const { root, directory, generate } = fixture(t);
  writeFileSync(join(directory, "material-symbols-rounded.woff2"), "corrupt font");
  assert.deepEqual(inspectIconFonts({ root, tokens }).issues, ["Invalid rounded font checksum"]);
  assert.deepEqual(ensureIconFonts({ root, tokens, log, regenerate: () => generate() }), { regenerated: true });
  assert.deepEqual(inspectIconFonts({ root, tokens }).issues, []);
});

for (const condition of ["missing manifest", "malformed manifest", "missing style", "missing generated files"]) {
  test(`${condition} is repaired before building`, (t) => {
    const { root, directory, generate } = fixture(t);
    const path = join(directory, "manifest.json");
    if (condition === "missing manifest") rmSync(path);
    if (condition === "malformed manifest") writeFileSync(path, "{invalid");
    if (condition === "missing style") {
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      delete manifest.fonts.rounded;
      writeFileSync(path, JSON.stringify(manifest));
    }
    if (condition === "missing generated files") {
      for (const file of ["material-symbols-rounded.woff2", "symbols.css", "LICENSE"]) rmSync(join(directory, file));
    }
    assert.ok(inspectIconFonts({ root, tokens }).issues.length);
    assert.deepEqual(ensureIconFonts({ root, tokens, log, regenerate: () => generate() }), { regenerated: true });
    assert.deepEqual(inspectIconFonts({ root, tokens }).issues, []);
  });
}

test("an unsuccessful repair still blocks the build", (t) => {
  const { root, generate } = fixture(t);
  generate("0.47.6");
  assert.throws(() => ensureIconFonts({ root, tokens, log, regenerate: () => {} }), /failed validation/);
  assert.throws(() => ensureIconFonts({ root, tokens, log, regenerate: () => { throw new Error("generator failed"); } }), /generator failed/);
  assert.ok(inspectIconFonts({ root, tokens }).issues.length);
});
