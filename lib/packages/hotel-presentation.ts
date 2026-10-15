import type { AoryxSearchParams, AoryxSearchResult, AoryxRoomOption, AoryxRoomPolicy, AoryxHotelInfoResult } from "@/types/aoryx";
import type { DestinationHotelSearch, DestinationHotelSearchResult, HotelOffer, HotelSummary } from "./contracts";
import { resolveAoryxMealCode } from "@/lib/aoryx-meals";
import { normalizeRoomPolicyDate } from "@/lib/room-policy";

export function destinationSearchInput(search: AoryxSearchParams, offset = 0): DestinationHotelSearch {
  return { destinationId: "cyprus", cityId: search.destinationCode ?? "", hotelId: search.hotelCode, checkIn: search.checkInDate, checkOut: search.checkOutDate, rooms: search.rooms.map(({ adults, childrenAges }) => ({ adults, childrenAges })), nationality: search.nationality, currency: search.currency === "USD" ? "USD" : "EUR", offset };
}
export function presentHotelSearch(result: DestinationHotelSearchResult, search: AoryxSearchParams): Omit<AoryxSearchResult, "sessionId"> & { partial: boolean; nextOffset: number | null } {
  const grouped = new Map<string, HotelOffer[]>();
  for (const offer of result.offers) grouped.set(offer.hotel.id, [...(grouped.get(offer.hotel.id) ?? []), offer]);
  return { currency: search.currency ?? null, propertyCount: grouped.size, responseTime: null, destination: { code: search.destinationCode ?? null, name: result.offers[0]?.hotel.city ?? null }, partial: result.partial, nextOffset: result.nextOffset, hotels: [...grouped.values()].map((offers) => {
    // Never compare different currencies as if their amounts were interchangeable.
    const sorted = [...offers].sort((a, b) => Number(b.price.currency === search.currency) - Number(a.price.currency === search.currency) || a.price.currency.localeCompare(b.price.currency) || a.price.amount - b.price.amount);
    const best = sorted[0], hotel = best.hotel;
    return { code: hotel.id, name: hotel.name, minPrice: best.price.amount, currency: best.price.currency, rating: hotel.stars, address: hotel.address, city: hotel.city, imageUrl: hotel.image, latitude: hotel.latitude, longitude: hotel.longitude, availableRates: sorted.filter((offer) => offer.price.currency === best.price.currency).map((offer) => ({ mealCode: resolveAoryxMealCode(offer.mealPlan), amount: offer.price.amount })) };
  }) };
}
/** Compatibility at the shared view boundary only. Opaque quote IDs are never Aoryx tokens. */
export function presentHotelRooms(offer: HotelOffer, search: AoryxSearchParams): AoryxRoomOption[] {
  const count = search.rooms.length, cents = Math.round(offer.price.amount * 100), share = Math.floor(cents / count);
  const policies: AoryxRoomPolicy[] = offer.cancellationPolicies.map((policy) => ({
    type: "CAN", textCondition: null, currency: policy.currency,
    conditions: [{
      fromDate: normalizeRoomPolicyDate(policy.from), toDate: null, fromTime: null, toTime: null,
      timezone: null, unit: null, text: null, nights: null, applicableOn: null,
      percentage: policy.type === "percent" ? policy.amount : null,
      fixed: policy.type === "amount" ? policy.amount : null,
    }],
  }));
  return search.rooms.map((room, index) => {
    const amount = (share + (index === count - 1 ? cents - share * count : 0)) / 100;
    return { id: `${offer.id}:${index}`, rateKey: offer.id, rateIdentity: offer.id, groupIdentity: offer.id, roomIdentifier: room.roomIdentifier, name: offer.roomName, boardType: offer.mealPlan, meal: offer.mealPlan, mealCode: resolveAoryxMealCode(offer.mealPlan), refundable: offer.refundable, currency: offer.price.currency, totalPrice: amount, displayTotalPrice: amount, availableRooms: null, policies, cancellationPolicy: offer.cancellationPolicies.map((policy) => `${policy.from}: ${policy.amount} ${policy.type === "percent" ? "%" : policy.currency}`).join("\n") || null, adultCount: room.adults, childCount: room.childrenAges.length, childAges: room.childrenAges, remarks: [...offer.notices, ...offer.payAtProperty.map((tax) => `${tax.description}: ${tax.amount} ${tax.currency}`)].map((text) => ({ type: "Information", text })) };
  });
}
export function presentHotelContent(hotel: HotelSummary, images: string[] = [], facilities: string[] = []): AoryxHotelInfoResult {
  return { systemId: hotel.id, destinationId: null, destinationName: hotel.city, name: hotel.name, rating: hotel.stars, tripAdvisorRating: null, tripAdvisorUrl: null, currencyCode: null, imageUrl: hotel.image, imageUrls: images.length ? images : hotel.image ? [hotel.image] : [], masterHotelAmenities: facilities.length ? facilities : null, address: { line1: hotel.address, line2: null, countryCode: "CY", countryName: "Cyprus", cityName: hotel.city, stateCode: null, zipCode: null }, geoCode: { lat: hotel.latitude, lon: hotel.longitude }, contact: null };
}
