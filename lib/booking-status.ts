export type BookingStatusKey = "confirmed" | "pending" | "failed" | "unknown";

const normalizeStatus = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const resolveBookingStatusKey = (status?: string | null): BookingStatusKey => {
  const normalized = normalizeStatus(status);
  if (!normalized) return "unknown";

  // Aoryx booking status "2" is a confirmed booking.
  if (normalized === "2") return "confirmed";
  if (normalized === "1" || normalized === "not confirmed") return "pending";
  // Aoryx v3 statuses 3, 4 and 9 are failed, cancelled and cancellation failed.
  if (["3", "4", "9"].includes(normalized)) return "failed";
  if (normalized.startsWith("not ")) return "pending";
  if (normalized.includes("confirm") || normalized.includes("complete")) return "confirmed";
  if (normalized.includes("fail") || normalized.includes("cancel")) return "failed";
  if (normalized.includes("pending") || normalized.includes("process")) return "pending";
  return "unknown";
};

export const isAoryxBookingResultConfirmed = (result: AoryxBookingResult | null | undefined): boolean => {
  if (!result) return false;
  const status = resolveBookingStatusKey(result.status);
  if (status === "confirmed") return true;
  if (status === "pending" || status === "failed") return false;
  return Boolean(
    result.hotelConfirmationNumber || result.supplierConfirmationNumber || result.adsConfirmationNumber
  );
};
import type { AoryxBookingResult } from "@/types/aoryx";
