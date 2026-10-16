import type { DestinationId, DestinationService } from "@/lib/destinations/registry";

export type Money = { amount: number; currency: string };
export type TravelParty = { adults: number; childrenAges: number[] }[];
export type TripContext = {
  destinationId: DestinationId;
  checkIn: string;
  checkOut: string;
  rooms: TravelParty;
  nationality: string;
};
export type HotelSummary = {
  id: string;
  destinationId: DestinationId;
  name: string;
  city: string;
  stars: number | null;
  image: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};
export type HotelOffer = {
  id: string;
  hotel: HotelSummary;
  roomName: string;
  mealPlan: string;
  price: Money;
  refundable: boolean | null;
  expiresAt: string;
  cancellationPolicies: { from: string; amount: number; currency: string; type: "amount" | "percent" }[];
  payAtProperty: { amount: number; currency: string; description: string }[];
  notices: string[];
};
export type DestinationHotelSearch = TripContext & {
  cityId: string;
  hotelId?: string;
  currency: "USD" | "EUR";
  offset?: number;
};
export type DestinationHotelSearchResult = { offers: HotelOffer[]; partial: boolean; nextOffset: number | null };
export type DestinationHotelPrebookResult = { offer: HotelOffer; contextKey: string; priceChanged: boolean; termsChanged: boolean };
export type ExtraServiceOffer = {
  id: string; service: "transfer" | "flight" | "attraction"; destinationId: "cyprus"; hotelOfferId: string; contextKey: string;
  title: string; price: Money; expiresAt: string;
  journeys: { from: string; to: string; departure: string; arrival?: string; description: string }[];
  conditions: string[];
  questions?: { code: string; text: string; required: boolean }[];
};
export type ExtraServiceSearchResult = { offers: ExtraServiceOffer[] };
export type ExtraServicePrebookResult = { offer: ExtraServiceOffer; priceChanged: boolean; termsChanged: boolean };
export type DestinationPaymentPlan = {
  version: 1;
  checkout: { provider: "megatours"; offerIds: string[]; totals: Money[]; paymentEnabled: boolean };
  flight: { provider: "kyte"; offerIds: string[]; totals: Money[]; paymentEnabled: false } | null;
};
/** totals contains only the MEGATOURS checkout amount; flights are quoted separately. */
export type DestinationPackageReview = { id: string; destinationId: "cyprus"; selectedServices: ("transfer" | "flight")[]; hotel: HotelOffer; services: ExtraServiceOffer[]; attraction?: ExtraServiceOffer | null; totals: Money[]; paymentPlan: DestinationPaymentPlan; expiresAt: string; paymentEnabled: boolean };
export type ValidatedServiceQuote = {
  id: string;
  service: DestinationService;
  destinationId: DestinationId;
  ownerId: string;
  contextKey: string;
  price: Money;
  expiresAt: string;
  validated: true;
};
export type PackageDraft = {
  version: 1;
  destinationId: DestinationId;
  ownerId: string;
  contextKey: string;
  selectedServices: DestinationService[];
  quotes: Partial<Record<DestinationService, ValidatedServiceQuote>>;
};
export type ServiceBookingState = "quoted" | "pending" | "confirmed" | "unknown" | "failed" | "cancelled";
export type DestinationOrder = {
  id: string; flightError?: boolean; hotelPaid: boolean; hotelStatus: "awaiting_payment" | "confirming" | "confirmed" | "failed" | "unknown";
  hotelReference?: string; hotel: { name: string; checkIn: string; checkOut: string };
  contact: { firstName: string; lastName: string; email: string; phone: string };
  guests: { firstName: string; lastName: string; title: string; type: "Adult" | "Child"; age: number }[];
  extras: { service: string; status: string; reference?: string }[];
  flight: { status: "not_selected" | "quoted" | "creating" | "ready" | "paying" | "challenge" | "pending" | "paid" | "ticketed" | "failed" | "unknown";
    offer: ExtraServiceOffer | null; amount: Money | null; reference: string | null; canPay: boolean;
    acceptedCards: string[]; ticketTimeLimit?: string; challenge?: { kind: "challenge3DS" | "challengePSP"; html?: string; data?: Record<string, string> } };
};
export type PreparedDestinationOrder = { order: DestinationOrder; totals: Money[]; expiresAt: string };
