"use client";
import type { AoryxSearchParams } from "@/types/aoryx";
import type { DestinationHotelSearchResult } from "./contracts";
import { destinationSearchInput, presentHotelRooms, presentHotelSearch } from "./hotel-presentation";
export async function searchDestinationHotelPresentation(search: AoryxSearchParams, signal?: AbortSignal, offset = 0) {
  const response = await fetch("/api/destinations/cyprus/hotels/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(destinationSearchInput(search, offset)), signal, cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP error ${response.status}`);
  const result = await response.json() as DestinationHotelSearchResult;
  return { result, presentation: presentHotelSearch(result, search), rooms: result.offers.flatMap((offer) => presentHotelRooms(offer, search)) };
}
