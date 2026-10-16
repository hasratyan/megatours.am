import type { PackageBuilderService, PackageBuilderState } from "@/lib/package-builder-state";
import type { ExtraServicePrebookResult } from "./contracts";
import { isInsuranceAddonCheckoutReady } from "@/lib/insurance-addon-checkout";

export function destinationPackageReviewInput(state: PackageBuilderState) {
  const selectedServices = (["transfer", "flight"] as const).filter((service) => state[service]?.selected === true);
  return {
    hotelOfferId: state.destinationQuotes?.hotel.offer.id,
    selectedServices,
    serviceOfferIds: selectedServices.flatMap((service) => {
      const id = state.destinationQuotes?.services?.[service]?.offer.id;
      return id ? [id] : [];
    }),
    ...(state.excursion?.selected ? { attractionOfferId: state.destinationQuotes?.attraction?.offer.id } : {}),
  };
}
export function isDestinationPackageReady(state: PackageBuilderState, now = Date.now()) {
  const hotel = state.destinationQuotes?.hotel;
  if (!state.hotel?.selected || !hotel || Date.parse(hotel.offer.expiresAt) <= now || !Number.isFinite(Date.parse(hotel.offer.expiresAt))) return false;
  if (state.insurance?.selected && !isInsuranceAddonCheckoutReady({ hasCheckoutTarget: true, selected: true, quoteLoading: state.insurance.quoteLoading === true, quoteError: state.insurance.quoteError, price: state.insurance.price })) return false;
  const selection = destinationPackageReviewInput(state);
  const extras = selection.selectedServices.map((service) => { const offer = state.destinationQuotes?.services?.[service]?.offer; return offer?.service === service ? offer : undefined; });
  if (state.excursion?.selected) extras.push(state.destinationQuotes?.attraction?.offer);
  return extras.every((offer) => offer && offer.hotelOfferId === hotel.offer.id && offer.contextKey === hotel.contextKey && Number.isFinite(Date.parse(offer.expiresAt)) && Date.parse(offer.expiresAt) > now);
}
/** Editing one service preserves the other explicitly selected hotel-bound services. */
export function applyDestinationServiceQuote(state: PackageBuilderState, quote: ExtraServicePrebookResult): PackageBuilderState {
  const offer = quote.offer, hotel = state.destinationQuotes?.hotel;
  if (!hotel || offer.hotelOfferId !== hotel.offer.id || offer.contextKey !== hotel.contextKey) return state;
  const selection = { selected: true, selectionId: offer.id, label: offer.title, price: offer.price.amount, currency: offer.price.currency };
  const destinationQuotes = { ...state.destinationQuotes!, review: undefined };
  if (offer.service === "attraction") destinationQuotes.attraction = quote;
  else destinationQuotes.services = { ...destinationQuotes.services, [offer.service]: quote };
  return { ...state, destinationQuotes, sessionExpiresAt: Math.min(state.sessionExpiresAt ?? Infinity, Date.parse(offer.expiresAt)), ...(offer.service === "attraction" ? { excursion: { ...selection, items: [{ id: offer.id, name: offer.title }] } } : offer.service === "transfer" ? { transfer: { ...selection, vehicleName: offer.title, includeReturn: true, transferOrigin: offer.journeys[0]?.from, transferDestination: offer.journeys[0]?.to } } : { flight: { ...selection, origin: offer.journeys[0]?.from, destination: offer.journeys[0]?.to, departureDate: state.hotel?.checkInDate, returnDate: state.hotel?.checkOutDate } }), updatedAt: Date.now() };
}
export function removeDestinationService(state: PackageBuilderState, service: Exclude<PackageBuilderService, "hotel">): PackageBuilderState {
  const next = { ...state, [service]: undefined, updatedAt: Date.now() };
  if (!state.destinationQuotes) return next;
  next.destinationQuotes = { ...state.destinationQuotes, review: undefined };
  if (service === "transfer" || service === "flight") next.destinationQuotes.services = { ...next.destinationQuotes.services, [service]: undefined };
  if (service === "excursion") next.destinationQuotes.attraction = undefined;
  return next;
}
