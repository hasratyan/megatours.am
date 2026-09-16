"use server";

import { headers } from "next/headers";
import { scheduleSearchHistory } from "@/lib/search-history";
import type { AoryxSearchParams } from "@/types/aoryx";
import {
  normalizeSearchError,
  runAoryxSearch,
  type SafeSearchResult,
  withAoryxDefaults,
} from "@/lib/aoryx-search";

export type SearchActionResult =
  | { ok: true; data: SafeSearchResult }
  | { ok: false; error: string; code?: string };

export async function runResultsSearch(payload: AoryxSearchParams): Promise<SearchActionResult> {
  try {
    const data = await runAoryxSearch(payload);

    scheduleSearchHistory(new Headers(await headers()), withAoryxDefaults(payload), data);

    return { ok: true, data };
  } catch (error) {
    const normalized = normalizeSearchError(error);
    return { ok: false, error: normalized.message, code: normalized.code };
  }
}
