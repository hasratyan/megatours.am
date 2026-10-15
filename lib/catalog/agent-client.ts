import "server-only";
import type { HotelSummary } from "@/lib/packages/contracts";

export type AgentCity = { id: string; name: string; hotelCount: number | null };
export type AgentCatalog = { cities?: AgentCity[]; hotels?: HotelSummary[]; hotel?: HotelSummary; images?: string[]; facilities?: string[]; nextOffset?: number | null };

export class AgentCatalogUnavailable extends Error {
  constructor() { super("The destination catalogue is temporarily unavailable."); }
}

/** The agent resolves catalogue publication; its service token never reaches the browser. */
export async function loadAgentCatalog(query: { resource: "cities" | "hotels" | "hotel"; cityId?: string; hotelId?: string; offset?: number }): Promise<AgentCatalog> {
  const base = process.env.B2C_AGENT_URL?.trim();
  const token = process.env.B2C_AGENT_TOKEN?.trim();
  if (!base || !token) throw new AgentCatalogUnavailable();
  const origin = new URL(base);
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new AgentCatalogUnavailable();
  const url = new URL("/api/b2c/v1/catalog", origin);
  url.searchParams.set("destination", "cyprus");
  url.searchParams.set("resource", query.resource);
  if (query.cityId) url.searchParams.set("cityId", query.cityId);
  if (query.hotelId) url.searchParams.set("hotelId", query.hotelId);
  if (query.offset) url.searchParams.set("offset", String(query.offset));
  try {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "error" });
    if (!response.ok) throw new AgentCatalogUnavailable();
    const body = await response.json() as AgentCatalog;
    if (query.resource === "cities" && !Array.isArray(body.cities)) throw new AgentCatalogUnavailable();
    if (query.resource === "hotels" && (!Array.isArray(body.hotels) || body.hotels.some((hotel) => hotel.destinationId !== "cyprus"))) throw new AgentCatalogUnavailable();
    if (query.resource === "hotel" && (!body.hotel || body.hotel.destinationId !== "cyprus" || body.hotel.id !== query.hotelId)) throw new AgentCatalogUnavailable();
    return body;
  } catch { throw new AgentCatalogUnavailable(); }
}
