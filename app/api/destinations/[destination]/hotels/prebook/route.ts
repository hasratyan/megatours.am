import { NextRequest, NextResponse } from "next/server";
import { DestinationServiceError, prebookDestinationHotel } from "@/lib/packages/agent-service-client";
import { destinationSearchSession, isSameOriginMutation } from "@/lib/packages/search-session";

export async function POST(request: NextRequest, { params }: { params: Promise<{ destination: string }> }) {
  const headers = { "cache-control": "private, no-store" };
  if ((await params).destination !== "cyprus") return NextResponse.json({ code: "invalid" }, { status: 404, headers });
  if (!isSameOriginMutation(request)) return NextResponse.json({ code: "invalid" }, { status: 403, headers });
  const session = destinationSearchSession(request);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return NextResponse.json({ code: "invalid" }, { status: 400, headers });
    const body = JSON.parse(raw) as { offerId?: unknown; mode?: unknown };
    if (typeof body.offerId !== "string" || !/^[0-9a-f-]{36}$/.test(body.offerId)) return NextResponse.json({ code: "invalid" }, { status: 400, headers });
    const result = await prebookDestinationHotel(body.offerId, session.ownerId, request.signal);
    return session.setCookie(NextResponse.json(result, { headers }));
  } catch (error) {
    return session.setCookie(NextResponse.json({ code: error instanceof DestinationServiceError ? error.code : "invalid" }, { status: error instanceof DestinationServiceError ? error.status : 400, headers }));
  }
}
