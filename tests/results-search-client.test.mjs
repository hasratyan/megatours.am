import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(`${root}${specifier.slice(2)}.ts`).href, context);
    }
    if (
      specifier.startsWith(".") &&
      !specifier.endsWith(".ts") &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes("/node_modules/")
    ) {
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(root).href) && url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
      };
    }
    return next(url, context);
  },
});

const { fetchResultsSearch } = await import("../lib/results-search-client.ts");
const { normalizeSearchError } = await import("../lib/aoryx-search.ts");
const { AoryxClientError } = await import("../lib/aoryx-client.ts");

test("results search converts proxy HTML into a safe localized fallback signal", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => new Response("<!DOCTYPE html><title>Bad gateway</title>", {
    status: 502,
    headers: { "Content-Type": "text/html" },
  });

  const result = await fetchResultsSearch("destinationCode=160-0", new AbortController().signal);
  assert.deepEqual(result, { ok: false, error: "" });
});

test("results search preserves structured API errors", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => Response.json({
    ok: false,
    error: "Search session is missing",
    code: "MISSING_SESSION_ID",
  }, { status: 502 });

  const result = await fetchResultsSearch("destinationCode=160-0", new AbortController().signal);
  assert.deepEqual(result, {
    ok: false,
    error: "Search session is missing",
    code: "MISSING_SESSION_ID",
  });
});

test("results search hides technical supplier client errors", () => {
  assert.deepEqual(
    normalizeSearchError(new AoryxClientError("Missing AORYX_API_KEY configuration")),
    { message: "" },
  );
});
