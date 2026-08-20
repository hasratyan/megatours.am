import type { BookingAddonServiceKey } from "@/lib/booking-addons";
import type { InsuranceIssuanceStatus } from "@/lib/insurance-policy-status";
import type { AoryxBookingPayload } from "@/types/aoryx";

export type BookingServiceRemovalErrorCode =
  | "service_not_attached"
  | "insurance_policy_confirmed"
  | "insurance_policy_pending";

export class BookingServiceRemovalError extends Error {
  code: BookingServiceRemovalErrorCode;

  constructor(code: BookingServiceRemovalErrorCode, message: string) {
    super(message);
    this.name = "BookingServiceRemovalError";
    this.code = code;
  }
}

const SERVICE_KEYS: BookingAddonServiceKey[] = [
  "transfer",
  "excursion",
  "insurance",
  "flight",
];

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const parseBookingServiceRemovalKeys = (value: unknown): BookingAddonServiceKey[] => {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<BookingAddonServiceKey>(SERVICE_KEYS);
  return Array.from(
    new Set(
      value
        .map((entry) => resolveString(entry).toLowerCase())
        .filter((entry): entry is BookingAddonServiceKey =>
          allowed.has(entry as BookingAddonServiceKey)
        )
    )
  );
};

export const resolveAttachedBookingServiceKeys = (
  payload: AoryxBookingPayload | null | undefined
): BookingAddonServiceKey[] => {
  if (!payload) return [];
  const keys: BookingAddonServiceKey[] = [];
  if (payload.transferSelection) keys.push("transfer");
  if (payload.excursions) keys.push("excursion");
  if (payload.insurance) keys.push("insurance");
  if (payload.airTickets) keys.push("flight");
  return keys;
};

export const removeBookingServices = (input: {
  payload: AoryxBookingPayload;
  serviceKeys: BookingAddonServiceKey[];
  insuranceStatus: InsuranceIssuanceStatus;
  insuranceHasIssuedPolicy?: boolean;
}): {
  payload: AoryxBookingPayload;
  removedServices: BookingAddonServiceKey[];
  clearInsuranceMetadata: boolean;
  insuranceStatusBefore: InsuranceIssuanceStatus;
} => {
  const requested = Array.from(new Set(input.serviceKeys));
  const attached = new Set(resolveAttachedBookingServiceKeys(input.payload));
  const missingServices = requested.filter((key) => !attached.has(key));
  if (missingServices.length > 0) {
    throw new BookingServiceRemovalError(
      "service_not_attached",
      `The following services are no longer attached to this booking: ${missingServices.join(", ")}.`
    );
  }

  const insuranceStatusBefore = input.insuranceStatus;

  if (requested.includes("insurance")) {
    if (insuranceStatusBefore === "confirmed" || input.insuranceHasIssuedPolicy) {
      throw new BookingServiceRemovalError(
        "insurance_policy_confirmed",
        "This insurance policy was already issued. Cancel it with EFES before removing it from the booking."
      );
    }
    if (insuranceStatusBefore !== "failed") {
      throw new BookingServiceRemovalError(
        "insurance_policy_pending",
        "Insurance issuance is not resolved. Verify its EFES status before removing it from the booking."
      );
    }
  }

  const nextPayload: AoryxBookingPayload = { ...input.payload };
  requested.forEach((key) => {
    if (key === "transfer") nextPayload.transferSelection = null;
    if (key === "excursion") nextPayload.excursions = null;
    if (key === "insurance") nextPayload.insurance = null;
    if (key === "flight") nextPayload.airTickets = null;
  });

  return {
    payload: nextPayload,
    removedServices: requested,
    clearInsuranceMetadata: requested.includes("insurance"),
    insuranceStatusBefore,
  };
};
