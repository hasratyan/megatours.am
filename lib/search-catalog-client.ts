"use client";

import { createAsyncTtlCache } from "@/lib/async-ttl-cache";
import { postJson } from "@/lib/api-helpers";
import type { HotelInfo } from "@/types/aoryx";
import type { DestinationId } from "@/lib/destinations/registry";
import type { AgentCatalog } from "@/lib/catalog/agent-client";

type Destinations = { destinations: Array<{ id: string; name: string; rawId: string }> };
const countries = createAsyncTtlCache<Destinations>(30 * 60_000, 8);
const hotels = createAsyncTtlCache<{ hotels: HotelInfo[] }>(30 * 60_000, 32);

export const loadSearchDestinations = (destination: DestinationId = "uae") => countries.get(destination, async () => {
  if (destination === "uae") return postJson<Destinations>("/api/aoryx/country-info", { countryCode: "AE" });
  const response = await fetch("/api/destinations/cyprus/catalog", { cache: "no-store" });
  if (!response.ok) throw new Error("Catalogue unavailable");
  const catalog = await response.json() as AgentCatalog;
  return { destinations: (catalog.cities ?? []).map((city) => ({ id: city.id, name: city.name, rawId: city.id })) };
});

export const loadSearchHotels = (destinationId: string, parentDestinationId: string, country: DestinationId = "uae") =>
  hotels.get(JSON.stringify([country, destinationId, parentDestinationId]), async () => {
    if (country === "uae") return postJson<{ hotels: HotelInfo[] }>("/api/aoryx/hotels-by-destination", { destinationId, parentDestinationId });
    const result: HotelInfo[] = [];
    let offset: number | null = 0;
    while (offset !== null && offset <= 5000) {
      const response = await fetch(`/api/destinations/cyprus/catalog?resource=hotels&cityId=${encodeURIComponent(destinationId)}&offset=${offset}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Catalogue unavailable");
      const catalog = await response.json() as AgentCatalog;
      result.push(...(catalog.hotels ?? []).map((hotel) => ({ destinationId, systemId: hotel.id, name: hotel.name, rating: hotel.stars, city: hotel.city, address: hotel.address, imageUrl: hotel.image, latitude: hotel.latitude, longitude: hotel.longitude })));
      offset = catalog.nextOffset ?? null;
    }
    return { hotels: result };
  });
