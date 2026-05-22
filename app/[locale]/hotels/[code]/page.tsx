import { Suspense, cache } from "react";
import HotelClient from "./hotel-client";
import JsonLd from "@/components/json-ld";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";
import { getHotelInfoFromDb } from "@/lib/hotel-info-db";
import { buildHotelShareTitle, resolveHotelPrimaryImageUrl } from "@/lib/hotel-share";
import { buildHotelStructuredData } from "@/lib/structured-data";
import type { AoryxHotelInfoResult } from "@/types/aoryx";

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const getHotelInfoCached = cache(async (code: string) => getHotelInfoFromDb(code));

const buildHotelMetaDescription = (
  hotelName: string,
  destinationName: string | null | undefined,
  locale: Locale
) => {
  const location = destinationName?.trim();
  if (locale === "hy") {
    return location
      ? `${hotelName} հյուրանոց ${location}-ում, ԱՄԷ. Դիտեք լուսանկարներ, հարմարություններ և ամրագրեք MEGATOURS-ում։`
      : `${hotelName} հյուրանոց ԱՄԷ-ում. Դիտեք լուսանկարներ, հարմարություններ և ամրագրեք MEGATOURS-ում։`;
  }
  if (locale === "ru") {
    return location
      ? `${hotelName} в ${location}, ОАЭ: фото, удобства и бронирование отеля на MEGATOURS.`
      : `${hotelName} в ОАЭ: фото, удобства и бронирование отеля на MEGATOURS.`;
  }
  return location
    ? `${hotelName} in ${location}, UAE: view photos, amenities, and book your hotel on MEGATOURS.`
    : `${hotelName} in the UAE: view photos, amenities, and book your hotel on MEGATOURS.`;
};

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
      const title = buildHotelShareTitle(info.name, resolvedLocale);
      const primaryImageUrl = resolveHotelPrimaryImageUrl(info);

      return buildLocalizedMetadata({
        locale: resolvedLocale,
        title,
        description: buildHotelMetaDescription(info.name, info.destinationName, resolvedLocale),
        path: `/hotels/${hotelCode}`,
        imagePath: primaryImageUrl,
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

  let hotelInfoResult: AoryxHotelInfoResult | null = null;
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

  const hotelStructuredData =
    hotelInfoResult && hotelCode
      ? buildHotelStructuredData({
          locale: resolvedLocale,
          hotel: hotelInfoResult,
          path: `/${resolvedLocale}/hotels/${hotelCode}`,
        })
      : null;

  return (
    <>
      {hotelStructuredData ? (
        <JsonLd id={`structured-data-hotel-${hotelCode}`} data={hotelStructuredData} />
      ) : null}
      <Suspense fallback={null}>
        <HotelClient
          initialHotelInfo={hotelInfoResult}
          initialRoomDetails={null}
          initialHotelError={hotelError}
          initialRoomsError={null}
          initialAmdRates={null}
        />
      </Suspense>
    </>
  );
}
