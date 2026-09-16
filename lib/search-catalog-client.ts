"use client";

import { createAsyncTtlCache } from "@/lib/async-ttl-cache";
import { postJson } from "@/lib/api-helpers";
import type { HotelInfo } from "@/types/aoryx";

type Destinations = { destinations: Array<{ id: string; name: string; rawId: string }> };
const countries = createAsyncTtlCache<Destinations>(30 * 60_000, 8);
const hotels = createAsyncTtlCache<{ hotels: HotelInfo[] }>(30 * 60_000, 32);

export const loadSearchDestinations = () => countries.get("AE", () =>
  postJson<Destinations>("/api/aoryx/country-info", { countryCode: "AE" }));

export const loadSearchHotels = (destinationId: string, parentDestinationId: string) =>
  hotels.get(JSON.stringify([destinationId, parentDestinationId]), () =>
    postJson<{ hotels: HotelInfo[] }>("/api/aoryx/hotels-by-destination", { destinationId, parentDestinationId }));
