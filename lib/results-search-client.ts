"use client";

import type { SearchActionResult } from "@/app/[locale]/results/actions";

export async function fetchResultsSearch(query: string, signal: AbortSignal): Promise<SearchActionResult> {
  const response = await fetch("/api/aoryx/results-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
    cache: "no-store",
  });
  // Error responses use the same localized fallback handling as the old action.
  return await response.json() as SearchActionResult;
}
