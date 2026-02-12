import { cache } from "react";
import HotelClient from "./hotel-client";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const getHotelInfoCached = cache(async (code: string) => getHotelInfoFromDb(code));

type PageProps = {
  params: Promise<{ locale: string; code?: string | string[] }>;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code?: string | string[] }> }) {
  const resolvedParams = await params;
  const resolvedLocale = resolveLocale(resolvedParams.locale);
  const t = getTranslations(resolvedLocale);
  const hotelCode = Array.isArray(resolvedParams.code) ? resolvedParams.code[0] : resolvedParams.code;

  if (!hotelCode) {
    return buildLocalizedMetadata({
      locale: resolvedLocale,
      title: t.results.hotel.fallbackName,
      description: t.hero.subtitle,
      path: "/hotels",
    });
  }

  try {
    const info = await getHotelInfoCached(hotelCode);
    if (info?.name) {
      return buildLocalizedMetadata({
        locale: resolvedLocale,
        title: info.name,
        description: t.hero.subtitle,
        path: `/hotels/${hotelCode}`,
      });
    }
  } catch (error) {
    console.error("[Metadata] Failed to load hotel name", error);
  }

  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: `${t.results.hotel.fallbackName} ${hotelCode}`,
    description: t.hero.subtitle,
    path: `/hotels/${hotelCode}`,
  });
}

export default async function HotelPage({ params }: PageProps) {
  const resolvedParams = await params;
  const resolvedLocale = resolveLocale(resolvedParams.locale);
  const t = getTranslations(resolvedLocale);
  const hotelCode = Array.isArray(resolvedParams.code) ? resolvedParams.code[0] : resolvedParams.code;

  let hotelInfoResult = null;
  let hotelError: string | null = null;

  if (hotelCode) {
    try {
      hotelInfoResult = await getHotelInfoCached(hotelCode);
      if (!hotelInfoResult) {
        hotelError = t.hotel.errors.loadHotelFailed;
      }
    } catch (error) {
      console.error("[HotelPage] Failed to load hotel info", error);
      hotelError = t.hotel.errors.loadHotelFailed;
    }
  }

  return (
    <HotelClient
      initialHotelInfo={hotelInfoResult}
      initialRoomDetails={null}
      initialHotelError={hotelError}
      initialRoomsError={null}
      initialAmdRates={null}
    />
  );
}
