export const HOTEL_SEARCH_FRESH_MS = 5 * 60 * 1000;

export type CompletedHotelSearch = {
  key: string;
  attempt: number;
  receivedAt: number;
};

/** Activity can restore UI state; only reuse availability for the same fresh search. */
export function isHotelSearchFresh(
  completed: CompletedHotelSearch | null,
  key: string,
  attempt: number,
  now: number,
) {
  return Boolean(completed && completed.key === key && completed.attempt === attempt
    && now >= completed.receivedAt && now - completed.receivedAt < HOTEL_SEARCH_FRESH_MS);
}

export function hotelImageTransitionName(hotelCode: string) {
  return `hotel-image-${Array.from(hotelCode, (character) => character.codePointAt(0)!.toString(16)).join("_")}`;
}
