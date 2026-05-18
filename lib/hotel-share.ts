import type { Locale } from "@/lib/i18n";
import type { AoryxHotelInfoResult } from "@/types/aoryx";

const bookNowLabelByLocale: Record<Locale, string> = {
  hy: "Ամրագրել հիմա",
  en: "Book now",
  ru: "Забронировать сейчас",
};

export const buildHotelShareTitle = (hotelName: string, locale: Locale) =>
  `${hotelName} | ${bookNowLabelByLocale[locale]}`;

export const resolveHotelPrimaryImageUrl = (hotelInfo?: AoryxHotelInfoResult | null) => {
  const directImage = hotelInfo?.imageUrl?.trim();
  if (directImage) return directImage;

  return hotelInfo?.imageUrls.find((imageUrl) => imageUrl.trim().length > 0)?.trim() ?? null;
};
