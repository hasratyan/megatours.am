import { NextRequest, NextResponse } from "next/server";
import { DestinationServiceError, searchDestinationHotels } from "@/lib/packages/agent-service-client";
import { destinationSearchSession, isSameOriginMutation } from "@/lib/packages/search-session";
import type { DestinationHotelSearch } from "@/lib/packages/contracts";

export async function POST(request: NextRequest, { params }: { params: Promise<{ destination: string }> }) {
  const headers = { "cache-control": "private, no-store" };
  if ((await params).destination !== "cyprus") return NextResponse.json({ error: "Destination not found." }, { status: 404, headers });
  if (!isSameOriginMutation(request)) return NextResponse.json({ code: "invalid" }, { status: 403, headers });
  const session = destinationSearchSession(request);
  try {
    const raw = await request.text();
    if (raw.length > 12_000) return NextResponse.json({ code: "invalid" }, { status: 400, headers });
    const body = JSON.parse(raw) as DestinationHotelSearch;
    if (!body || typeof body.cityId !== "string" || !Array.isArray(body.rooms)) return NextResponse.json({ code: "invalid" }, { status: 400, headers });
    // Select supported fields; browser-supplied owner, market, and markup are ignored.
    const search: DestinationHotelSearch = { destinationId: "cyprus", cityId: body.cityId, hotelId: typeof body.hotelId === "string" ? body.hotelId : undefined, checkIn: body.checkIn, checkOut: body.checkOut, rooms: body.rooms, nationality: body.nationality, currency: body.currency, offset: body.offset };
    const result = await searchDestinationHotels(search, session.ownerId, request.signal);
    if (!Array.isArray(result.offers) || result.offers.some((offer) => offer.hotel.destinationId !== "cyprus")) throw new DestinationServiceError(503, "unavailable");
    return session.setCookie(NextResponse.json(result, { headers }));
  } catch (error) {
    return session.setCookie(NextResponse.json({ code: error instanceof DestinationServiceError ? error.code : "invalid" }, { status: error instanceof DestinationServiceError ? error.status : 400, headers }));
  }
}
