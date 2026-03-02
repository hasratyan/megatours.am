const BOOKING_MODIFICATION_TIME_ZONE = "Asia/Yerevan";

const normalizeIsoDate = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BOOKING_MODIFICATION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const resolveTodayIsoDate = (now: Date = new Date()): string => {
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
};

export const isBookingModificationClosed = (
  checkOutDate: string | null | undefined,
  now?: Date
): boolean => {
  const normalizedCheckOutDate = normalizeIsoDate(checkOutDate);
  if (!normalizedCheckOutDate) return false;
  return normalizedCheckOutDate < resolveTodayIsoDate(now);
};
