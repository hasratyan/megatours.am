import { NextRequest, NextResponse } from "next/server";
import { fetchExcursions } from "@/lib/aoryx-addons";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import { buildExcursionFacets } from "@/lib/b2b-facets";

export const runtime = "nodejs";

const parseLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 200;
  return Math.min(Math.max(Math.floor(parsed), 1), 200);
};

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:search");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const limit = parseLimit((body as { limit?: unknown }).limit);

    const { excursions, excursionFee } = await fetchExcursions(limit);
    const facets = buildExcursionFacets(excursions);

    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: {
          count: excursions.length,
          excursionFee,
          excursions,
          facets,
        },
      }),
      auth.context
    );
  } catch (error) {
    console.error("[B2B][excursions] Failed to fetch excursion options", error);
    return withB2bGatewayHeaders(
      NextResponse.json(
        {
          error: "Failed to fetch excursion options",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}

