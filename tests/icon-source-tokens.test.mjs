import assert from "node:assert/strict";
import test from "node:test";
import { getIconTokensFromSource } from "../scripts/icon-source-tokens.mjs";

test("module paths do not require icons, including the search-history regression", () => {
  const tokens = getIconTokensFromSource("fixture.tsx", `
    import { scheduleSearchHistory } from "@/lib/search-history";
    import "./history.css";
    export { record } from "./history";
    export * from "./history";
    const lazy = () => import("./history");
    const dynamic = () => import(\`./history/\${name}\`);
    const common = require("./history");
    import legacy = require("./history");
    type History = import("./history").History;
    // history in a comment is not an icon either
    const history = window.history;
  `);
  assert.equal(tokens.has("history"), false);
});

test("real JSX, conditional, and mapped icon names remain required", () => {
  const tokens = getIconTokensFromSource("fixture.tsx", `
    import { helper } from "./search-history";
    const icons = { previous: "history", next: "arrow_forward" };
    const view = <span className="material-symbols-rounded">history</span>;
    const conditional = <span>{open ? "close" : "menu"}</span>;
  `);
  for (const icon of ["history", "arrow_forward", "close", "menu"]) assert.ok(tokens.has(icon), icon);
});

test("CSS and JSON icon literals remain covered", () => {
  assert.ok(getIconTokensFromSource("fixture.css", '.icon::after { content: "history"; }').has("history"));
  assert.ok(getIconTokensFromSource("fixture.json", '{"icon":"history"}').has("history"));
  assert.equal(getIconTokensFromSource("fixture.css", '/* history */ .icon {}').has("history"), false);
});
