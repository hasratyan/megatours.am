import { after } from "next/server";
import { auth, toAppSession } from "@/lib/auth";
import { recordUserSearch } from "@/lib/user-data";
import type { AoryxSearchParams, AoryxSearchResult } from "@/types/aoryx";

/** Capture headers before calling this from a Server Component. */
export function scheduleSearchHistory(
  requestHeaders: Headers,
  params: AoryxSearchParams,
  result: Pick<AoryxSearchResult, "propertyCount" | "destination">,
) {
  const capturedHeaders = new Headers(requestHeaders);
  const resultSummary = {
    propertyCount: result.propertyCount ?? null,
    destinationCode: result.destination?.code ?? null,
    destinationName: result.destination?.name ?? null,
  };
  after(async () => {
    try {
      const session = await toAppSession(await auth.api.getSession({ headers: capturedHeaders }));
      if (session?.user?.id) {
        await recordUserSearch({ userId: session.user.id, params, resultSummary, source: "aoryx" });
      }
    } catch (error) {
      console.error("[Aoryx][search] Failed to record user search", error);
    }
  });
}
