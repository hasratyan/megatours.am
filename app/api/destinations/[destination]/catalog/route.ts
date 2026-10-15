import { NextRequest, NextResponse } from "next/server";
import { loadAgentCatalog } from "@/lib/catalog/agent-client";

export async function GET(request: NextRequest, { params }: { params: Promise<{ destination: string }> }) {
  const { destination } = await params;
  if (destination !== "cyprus") return NextResponse.json({ error: "Destination not found." }, { status: 404 });
  const resource = request.nextUrl.searchParams.get("resource") ?? "cities";
  const cityId = request.nextUrl.searchParams.get("cityId")?.trim();
  const hotelId = request.nextUrl.searchParams.get("hotelId")?.trim();
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  if (!["cities", "hotels", "hotel"].includes(resource) || (resource === "hotels" && (!cityId || cityId.length > 150)) || (resource === "hotel" && (!hotelId || hotelId.length > 150)) || !Number.isInteger(offset) || offset < 0 || offset > 5000) return NextResponse.json({ error: "Invalid catalogue request." }, { status: 400 });
  try {
    const data = await loadAgentCatalog({ resource: resource as "cities" | "hotels" | "hotel", cityId, hotelId, offset });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The destination catalogue is temporarily unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
