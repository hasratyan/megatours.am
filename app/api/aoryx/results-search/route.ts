import { NextRequest, NextResponse } from "next/server";
import { parseSearchParams } from "@/lib/search-query";
import { normalizeSearchError, runAoryxSearch, withAoryxDefaults } from "@/lib/aoryx-search";
import { scheduleSearchHistory } from "@/lib/search-history";
import { createSearchTiming } from "@/lib/search-timing";

export const runtime = "nodejs";

// Preserve the results page's existing markup and token policy. The older
// /search endpoint serves other callers with a different pricing lookup.
export async function POST(request: NextRequest) {
  const timing = createSearchTiming();
  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.query !== "string" || body.query.length > 8_000) {
      return NextResponse.json({ ok: false, error: "Invalid search query" }, { status: 400 });
    }
    const parsed = parseSearchParams(new URLSearchParams(body.query));
    if (!parsed.payload || parsed.notice) {
      return NextResponse.json({ ok: false, error: parsed.error ?? parsed.notice }, { status: 400 });
    }
    const data = await timing.measure("search_total", () => runAoryxSearch(parsed.payload!, {
      signal: request.signal,
      timing,
    }));
    request.signal.throwIfAborted();
    scheduleSearchHistory(request.headers, withAoryxDefaults(parsed.payload), data);
    return NextResponse.json({ ok: true, data }, {
      headers: { "Cache-Control": "private, no-store", "Server-Timing": timing.header() },
    });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    const normalized = normalizeSearchError(error);
    return NextResponse.json({ ok: false, error: normalized.message, code: normalized.code }, {
      status: 502,
      headers: { "Cache-Control": "private, no-store", "Server-Timing": timing.header() },
    });
  }
}
