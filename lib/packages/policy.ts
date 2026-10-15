import { getDestination, requiredServices } from "@/lib/destinations/registry";
import type { PackageDraft, ServiceBookingState } from "./contracts";
import type { DestinationService } from "@/lib/destinations/registry";

/** Run on trusted, server-loaded quotes, never on browser-selected booleans/prices. */
export function validatePackageDraft(draft: PackageDraft, now = Date.now()): void {
  const destination = getDestination(draft.destinationId);
  if (!destination || !Array.isArray(draft.selectedServices) || draft.selectedServices.some((service) => !["hotel", "transfer", "flight"].includes(service))) throw new Error("Unsupported destination or service.");
  if (!draft.ownerId || !draft.contextKey) throw new Error("Package context is missing.");
  const services = new Set(requiredServices(draft.selectedServices));
  if (Object.keys(draft.quotes).some((service) => !services.has(service as DestinationService))) throw new Error("An unselected service cannot be included in the package.");
  for (const service of services) {
    const quote = draft.quotes[service];
    if (!quote || quote.validated !== true || quote.service !== service || !quote.id) throw new Error(`A validated ${service} quote is required.`);
    if (quote.destinationId !== draft.destinationId || quote.ownerId !== draft.ownerId || quote.contextKey !== draft.contextKey) throw new Error("Package selection changed. Please search again.");
    if (!Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now) throw new Error("A package quote has expired. Please refresh your selection.");
    if (!Number.isFinite(quote.price.amount) || quote.price.amount <= 0 || !/^[A-Z]{3}$/.test(quote.price.currency)) throw new Error("Invalid package price.");
  }
}

export function isPackageComplete(selected: PackageDraft["selectedServices"], states: Partial<Record<DestinationService, ServiceBookingState>>): boolean {
  return Array.isArray(selected) && selected.every((service) => ["hotel", "transfer", "flight"].includes(service)) && requiredServices(selected).every((service) => states[service] === "confirmed");
}
