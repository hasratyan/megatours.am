import { NextRequest, NextResponse } from "next/server";
import { fetchTransferRates } from "@/lib/aoryx-addons";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import { buildTransferFacets } from "@/lib/b2b-facets";

export const runtime = "nodejs";

const parseString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseTravelDate = (value: unknown): string | Date | null | undefined => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return undefined;
};

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:search");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const destinationLocationCode = parseString(
      (body as { destinationLocationCode?: unknown }).destinationLocationCode
    );
    const destinationName = parseString((body as { destinationName?: unknown }).destinationName);
    const transferType = parseString((body as { transferType?: unknown }).transferType);
    const paxCount = Number((body as { paxCount?: unknown }).paxCount);
    const travelDate = parseTravelDate((body as { travelDate?: unknown }).travelDate);

    if (!destinationLocationCode && !destinationName) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: "destinationLocationCode or destinationName is required",
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    const transfers = await fetchTransferRates({
      destinationLocationCode,
      destinationName,
      transferType: transferType ? transferType.toUpperCase() : undefined,
      paxCount,
      travelDate,
    });
    const facets = buildTransferFacets(transfers);

    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: {
          destinationLocationCode: destinationLocationCode || null,
          destinationName: destinationName || null,
          transfers,
          facets,
        },
      }),
      auth.context
    );
  } catch (error) {
    console.error("[B2B][transfers] Failed to fetch transfer options", error);
    return withB2bGatewayHeaders(
      NextResponse.json(
        {
          error: "Failed to fetch transfer options",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
