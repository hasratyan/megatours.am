import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".css"]);

// Import paths name modules, not icons. Keep actual literal content, including
// translations, JSX, and conditional icon names, in the coverage check.
export function getIconTokensFromSource(path, source) {
  const tokens = new Set();
  const collect = (text) => {
    for (const match of text.matchAll(/\b[a-z][a-z0-9_]*\b/g)) tokens.add(match[0]);
  };
  if (extname(path) === ".css") {
    collect(source.replace(/\/\*[\s\S]*?\*\//g, ""));
    return tokens;
  }
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      ts.forEachChild(node, (child) => { if (child !== node.moduleSpecifier) visit(child); });
      return;
    }
    if (ts.isExternalModuleReference(node)) return;
    if (ts.isImportTypeNode(node)) {
      ts.forEachChild(node, (child) => { if (child !== node.argument) visit(child); });
      return;
    }
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      // Includes template-literal paths used by dynamic imports.
      node.arguments.slice(1).forEach(visit);
      return;
    }
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) collect(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return tokens;
}

export function getIconSourceTokens() {
  const tokens = new Set();
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!extensions.has(extname(path))) continue;
      for (const token of getIconTokensFromSource(path, readFileSync(path, "utf8"))) tokens.add(token);
    }
  }
  for (const directory of ["app", "components", "lib", "types"]) scan(join(root, directory));
  return tokens;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify([...getIconSourceTokens()].sort()));
}
