import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css"]);

// Inspect literal content, including translations and conditional icon names.
// Do not make code comments or ordinary identifiers part of font coverage.
export function getIconSourceTokens() {
  const tokens = new Set();
  const collect = (text) => {
    for (const match of text.matchAll(/\b[a-z][a-z0-9_]*\b/g)) tokens.add(match[0]);
  };
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!extensions.has(extname(path))) continue;
      const source = readFileSync(path, "utf8");
      if (extname(path) === ".css") {
        collect(source.replace(/\/\*[\s\S]*?\*\//g, ""));
        continue;
      }
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) collect(node.text);
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  for (const directory of ["app", "components", "lib", "types"]) scan(join(root, directory));
  return tokens;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify([...getIconSourceTokens()].sort()));
}
