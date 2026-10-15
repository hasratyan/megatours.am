import { NextRequest, NextResponse } from "next/server";
import { agentService, DestinationServiceError } from "./agent-service-client";
import { destinationSearchSession, isSameOriginMutation } from "./search-session";

export async function destinationServiceProxy(request: NextRequest, params: Promise<{ destination: string }>, operation: "services/search" | "services/prebook" | "packages/review" | "attractions/search" | "attractions/prebook") {
  const headers = { "cache-control": "private, no-store" };
  if ((await params).destination !== "cyprus") return NextResponse.json({ code: "invalid" }, { status: 404, headers });
  if (!isSameOriginMutation(request)) return NextResponse.json({ code: "invalid" }, { status: 403, headers });
  const session = destinationSearchSession(request);
  try {
    const raw = await request.text();
    if (raw.length > 3000) return NextResponse.json({ code: "invalid" }, { status: 400, headers });
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body.hotelOfferId !== "string" || !/^[0-9a-f-]{36}$/.test(body.hotelOfferId)) return NextResponse.json({ code: "invalid" }, { status: 400, headers });
    if (operation === "packages/review" && ("mode" in body || "serviceOfferId" in body)) return session.setCookie(NextResponse.json({ code: "expired" }, { status: 409, headers }));
    const allowed = operation === "services/search" ? ["service", "airport", "origin", "arrivalTime", "departureTime"] : operation === "packages/review" ? ["attractionOfferId"] : operation === "attractions/search" ? [] : ["offerId"];
    let selected: { selectedServices: string[]; serviceOfferIds: string[] } | undefined;
    if (operation === "packages/review") {
      const selectedServices = body.selectedServices ?? [], serviceOfferIds = body.serviceOfferIds ?? [];
      if (!Array.isArray(selectedServices) || selectedServices.length > 2 || selectedServices.some((service) => service !== "transfer" && service !== "flight") || new Set(selectedServices).size !== selectedServices.length || !Array.isArray(serviceOfferIds) || serviceOfferIds.length > 2 || serviceOfferIds.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) || new Set(serviceOfferIds).size !== serviceOfferIds.length) return session.setCookie(NextResponse.json({ code: "invalid" }, { status: 400, headers }));
      selected = { selectedServices, serviceOfferIds };
    }
    const payload = { hotelOfferId: body.hotelOfferId, ownerId: session.ownerId, ...Object.fromEntries(allowed.filter((key) => typeof body[key] === "string").map((key) => [key, body[key]])), ...selected };
    const result = await agentService(operation, payload, request.signal);
    return session.setCookie(NextResponse.json(result, { headers }));
  } catch (error) {
    return session.setCookie(NextResponse.json({ code: error instanceof DestinationServiceError ? error.code : "invalid" }, { status: error instanceof DestinationServiceError ? error.status : 400, headers }));
  }
}
