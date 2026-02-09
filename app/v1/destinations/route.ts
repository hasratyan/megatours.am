import { NextRequest, NextResponse } from "next/server";
import { AoryxClientError, AoryxServiceError } from "@/lib/aoryx-client";
import { listAoryxDestinations } from "@/lib/aoryx-destinations";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";

export const runtime = "nodejs";

const parseLimit = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function GET(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:search");
  if (!auth.ok) return auth.response;

  try {
    const countryCode = request.nextUrl.searchParams.get("countryCode") ?? undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

    const result = await listAoryxDestinations({ countryCode, q, limit });

    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: {
          countryCode: result.countryCode,
          count: result.destinations.length,
          destinations: result.destinations,
        },
      }),
      auth.context
    );
  } catch (error) {
    if (error instanceof AoryxServiceError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: error.message,
            code: error.code ?? null,
            requestId: auth.context.requestId,
          },
          { status: 400 }
        ),
        auth.context
      );
    }

    if (error instanceof AoryxClientError) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          {
            error: error.message,
            requestId: auth.context.requestId,
          },
          { status: 502 }
        ),
        auth.context
      );
    }

    return withB2bGatewayHeaders(
      NextResponse.json(
        {
          error: "Failed to fetch destinations",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}

