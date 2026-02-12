import { NextRequest, NextResponse } from "next/server";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";

export const runtime = "nodejs";

const parseString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:search");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const hotelCode = parseString((body as { hotelCode?: unknown }).hotelCode);

    if (!hotelCode) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "hotelCode is required", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    const data = await getHotelInfoFromDb(hotelCode);
    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data,
      }),
      auth.context
    );
  } catch {
    return withB2bGatewayHeaders(
      NextResponse.json(
        {
          error: "Failed to load hotel information",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
