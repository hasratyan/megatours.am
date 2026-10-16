import type { ExtraServiceOffer } from "./contracts";
import { normalizeRoomPolicyDate } from "@/lib/room-policy";

export type ServiceCategory = "all" | "car" | "bus" | "sea" | "sightseeing";

/** Categories describe the public vehicle/activity name, never a guessed tariff or capacity. */
export function serviceOfferCategory(offer: ExtraServiceOffer): ServiceCategory {
  const text = [offer.title, ...offer.journeys.map((journey) => journey.description)].join(" ").toLowerCase();
  if (offer.service === "transfer") {
    if (/\b(bus|coach|minibus|shuttle)\b/.test(text)) return "bus";
    if (/\b(car|sedan|suv|taxi|limousine|minivan|van)\b/.test(text)) return "car";
  }
  if (offer.service === "attraction") {
    if (/\b(boat|cruise|yacht|catamaran|sail(?:ing)?|snorkel(?:ling|ing)?|diving|sea caves?)\b|blue lagoon/.test(text)) return "sea";
    if (/\b(tour|sightseeing|museum|heritage|village|monastery|archaeolog\w*|troodos|nicosia|walking)\b/.test(text)) return "sightseeing";
  }
  return "all";
}

export function filterServiceOffers(offers: readonly ExtraServiceOffer[], category: ServiceCategory, query: string): ExtraServiceOffer[] {
  const normalized = query.trim().toLocaleLowerCase();
  return offers.filter((offer) => (category === "all" || serviceOfferCategory(offer) === category) &&
    (!normalized || [offer.title, ...offer.journeys.flatMap((journey) => [journey.from, journey.to, journey.description])].join(" ").toLocaleLowerCase().includes(normalized)));
}

export function serviceDate(value: string | null | undefined, locale: string): string | null {
  const date = normalizeRoomPolicyDate(value)?.slice(0, 10);
  if (!date) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function serviceTime(value: string | undefined): string | null {
  return value?.match(/T(\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?$/)?.[1] ?? null;
}

export function serviceCondition(value: string, locale: string, fromLabel: string): string {
  const match = /^(.+):\s*(-?\d+(?:[.,]\d+)?\s+.*)$/.exec(value.trim());
  const date = match && serviceDate(match[1], locale);
  return date && match ? `${fromLabel} ${date} · ${match[2]}` : value;
}

export function isWizzAirOffer(offer: ExtraServiceOffer): boolean {
  return offer.service === "flight" && offer.journeys.length > 0 && offer.journeys.every((journey) =>
    journey.description.split("·").every((segment) => /^W[469]\s*\d+$/i.test(segment.trim())));
}
