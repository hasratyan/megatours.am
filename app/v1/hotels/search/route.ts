import { NextRequest, NextResponse } from "next/server";
import { AoryxClientError, AoryxServiceError } from "@/lib/aoryx-client";
import { runAoryxSearch } from "@/lib/aoryx-search";
import { authenticateB2bRequest, withB2bGatewayHeaders } from "@/lib/b2b-gateway";
import type { AoryxRoomSearch, AoryxSearchParams } from "@/types/aoryx";

export const runtime = "nodejs";

const parseString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const parseNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const parseRooms = (value: unknown): AoryxRoomSearch[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ roomIdentifier: 1, adults: 2, childrenAges: [] }];
  }

  const rooms = value
    .map((room, index) => {
      if (!room || typeof room !== "object") return null;
      const record = room as Record<string, unknown>;
      const roomIdentifier = parseNumber(record.roomIdentifier) ?? index + 1;
      const adults = parseNumber(record.adults);
      const rawChildrenAges = Array.isArray(record.childrenAges) ? record.childrenAges : [];
      const childrenAges = rawChildrenAges
        .map((age) => parseNumber(age))
        .filter((age): age is number => typeof age === "number" && age >= 0 && age <= 17);

      return {
        roomIdentifier: roomIdentifier > 0 ? roomIdentifier : index + 1,
        adults: adults && adults > 0 ? adults : 2,
        childrenAges,
      } satisfies AoryxRoomSearch;
    })
    .filter((room): room is AoryxRoomSearch => Boolean(room));

  return rooms.length > 0 ? rooms : [{ roomIdentifier: 1, adults: 2, childrenAges: [] }];
};

export async function POST(request: NextRequest) {
  const auth = authenticateB2bRequest(request, "hotels:search");
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    const destinationCode = parseString((body as { destinationCode?: unknown }).destinationCode);
    const hotelCode = parseString((body as { hotelCode?: unknown }).hotelCode);
    const countryCode = parseString((body as { countryCode?: unknown }).countryCode) || "AE";
    const nationality = parseString((body as { nationality?: unknown }).nationality) || "AM";
    const currency = parseString((body as { currency?: unknown }).currency) || "USD";
    const checkInDate = parseString((body as { checkInDate?: unknown }).checkInDate);
    const checkOutDate = parseString((body as { checkOutDate?: unknown }).checkOutDate);
    const rooms = parseRooms((body as { rooms?: unknown }).rooms);

    if (!destinationCode && !hotelCode) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "Either destinationCode or hotelCode is required", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    if (!checkInDate || !checkOutDate) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "checkInDate and checkOutDate are required", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    if (!isIsoDate(checkInDate) || !isIsoDate(checkOutDate)) {
      return withB2bGatewayHeaders(
        NextResponse.json(
          { error: "Dates must be in YYYY-MM-DD format", requestId: auth.context.requestId },
          { status: 400 }
        ),
        auth.context
      );
    }

    const payload: AoryxSearchParams = {
      destinationCode: destinationCode || undefined,
      hotelCode: hotelCode || undefined,
      countryCode,
      nationality,
      currency,
      checkInDate,
      checkOutDate,
      rooms,
    };

    const result = await runAoryxSearch(payload, {
      environment: auth.context.aoryxEnvironment,
    });
    return withB2bGatewayHeaders(
      NextResponse.json({
        requestId: auth.context.requestId,
        data: result,
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
          error: "Failed to perform hotel search",
          requestId: auth.context.requestId,
        },
        { status: 500 }
      ),
      auth.context
    );
  }
}
