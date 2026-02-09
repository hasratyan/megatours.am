export type BookingStatusKey = "confirmed" | "pending" | "failed" | "unknown";

const normalizeStatus = (value?: string | null) => (value ?? "").trim().toLowerCase();

export const resolveBookingStatusKey = (status?: string | null): BookingStatusKey => {
  const normalized = normalizeStatus(status);
  if (!normalized) return "unknown";

  // Aoryx booking status "2" is a confirmed booking.
  if (normalized === "2") return "confirmed";
  // Aoryx cancellation status "4" indicates canceled/refunded flow.
  if (normalized === "4") return "failed";
  if (normalized.includes("confirm") || normalized.includes("complete")) return "confirmed";
  if (normalized.includes("fail") || normalized.includes("cancel")) return "failed";
  if (normalized.includes("pending") || normalized.includes("process")) return "pending";
  return "unknown";
};
