"use client";

import type { SearchActionResult } from "@/app/[locale]/results/actions";

const unavailableSearchResult = (): SearchActionResult => ({ ok: false, error: "" });

export async function fetchResultsSearch(query: string, signal: AbortSignal): Promise<SearchActionResult> {
  const response = await fetch("/api/aoryx/results-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
    cache: "no-store",
  });

  // Cloudflare and other proxies can replace an upstream failure with HTML or
  // plain text. Never expose a JSON parse error to the results page; an empty
  // error intentionally selects the page's localized fallback message.
  const payload = await response.json().catch(() => null) as Partial<SearchActionResult> | null;
  if (!payload || typeof payload !== "object") return unavailableSearchResult();
  if (payload.ok === true && "data" in payload) return payload as SearchActionResult;
  if (payload.ok === false) {
    return {
      ok: false,
      error: typeof payload.error === "string" ? payload.error : "",
      code: typeof payload.code === "string" ? payload.code : undefined,
    };
  }
  return unavailableSearchResult();
}
