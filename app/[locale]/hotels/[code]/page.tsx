import { getTranslations } from "@/lib/i18n-server";
import { Suspense, cache } from "react";
import HotelClient from "./hotel-client";
import JsonLd from "@/components/json-ld";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, Locale, locales } from "@/lib/i18n";
import { getHotelContent } from "@/lib/hotel-content";
import RouteLoading from "@/components/route-loading";
import { buildHotelShareTitle, resolveHotelPrimaryImageUrl } from "@/lib/hotel-share";
import { buildHotelStructuredData } from "@/lib/structured-data";
import type { AoryxHotelInfoResult } from "@/types/aoryx";
import { navigation } from "next/cache";
import { getHotelGalleryImages, getHotelPrefetchSummary } from "@/lib/hotel-presentation";
import ImageGallery from "./ImageGallery";
import HotelAmenities from "./HotelAmenities";
import { loadAgentCatalog } from "@/lib/catalog/agent-client";
import { presentHotelContent } from "@/lib/packages/hotel-presentation";

export const ensureStatic = "prefetch";

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const getHotelInfoCached = cache(async (code: string, country = "AE") => {
  if (country !== "CY") return getHotelContent(code);
  const { hotel, images, facilities } = await loadAgentCatalog({ resource: "hotel", hotelId: code });
  return hotel ? presentHotelContent(hotel, images, facilities) : null;
});

const buildHotelMetaDescription = (
  hotelName: string,
  destinationName: string | null | undefined,
  locale: Locale,
  country = "AE",
) => {
  const location = destinationName?.trim();
  if (country === "CY") return locale === "hy" ? `${hotelName}, Կիպրոս. Դիտեք լուսանկարներ, հարմարություններ և ամրագրեք MEGATOURS-ում։` : locale === "ru" ? `${hotelName}, Кипр: фото, удобства и бронирование на MEGATOURS.` : `${hotelName}, Cyprus: photos, amenities and booking on MEGATOURS.`;
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedLocale = resolveLocale(resolvedParams.locale);
  const t = getTranslations(resolvedLocale);
  const hotelCode = Array.isArray(resolvedParams.code) ? resolvedParams.code[0] : resolvedParams.code;
  const query = await searchParams;
  const country = query.countryCode === "CY" || query.destinationId === "cyprus" ? "CY" : "AE";

  if (!hotelCode) {
    return buildLocalizedMetadata({
      locale: resolvedLocale,
      title: t.results.hotel.fallbackName,
      description: t.hero.subtitle,
      path: "/hotels",
    });
  }

  try {
    const info = await getHotelInfoCached(hotelCode, country);
    if (info?.name) {
      const title = buildHotelShareTitle(info.name, resolvedLocale);
      const primaryImageUrl = resolveHotelPrimaryImageUrl(info);

      return buildLocalizedMetadata({
        locale: resolvedLocale,
        title,
        description: buildHotelMetaDescription(info.name, info.destinationName, resolvedLocale, country),
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

export default function HotelPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={<RouteLoading className="results" />}>
      <HotelContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function HotelContent({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedLocale = resolveLocale(resolvedParams.locale);
  const t = getTranslations(resolvedLocale);
  const hotelCode = Array.isArray(resolvedParams.code) ? resolvedParams.code[0] : resolvedParams.code;
  const query = await searchParams;
  const country = query.countryCode === "CY" || query.destinationId === "cyprus" ? "CY" : "AE";

  let hotelInfoResult: AoryxHotelInfoResult | null = null;
  let hotelError: string | null = null;

  if (hotelCode) {
    try {
      hotelInfoResult = await getHotelInfoCached(hotelCode, country);
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
          hotel: { ...hotelInfoResult, imageUrls: hotelInfoResult.imageUrls.slice(0, 5) },
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
          initialHotelInfo={hotelInfoResult ? getHotelPrefetchSummary(hotelInfoResult) : null}
          gallery={hotelInfoResult && hotelCode ? (
            <Suspense fallback={
              <ImageGallery hotelCode={hotelCode}
                images={getHotelGalleryImages(hotelInfoResult.imageUrls).slice(0, 1)}
                altText={hotelInfoResult.name ?? t.results.hotel.fallbackName} />
            }>
              <HotelGallery hotelCode={hotelCode} locale={resolvedLocale} country={country} />
            </Suspense>
          ) : null}
          amenities={hotelInfoResult && hotelCode ? (
            <Suspense fallback={null}>
              <HotelAmenityContent hotelCode={hotelCode} country={country} />
            </Suspense>
          ) : null}
          initialRoomDetails={null}
          initialHotelError={hotelError}
          initialRoomsError={null}
          initialAmdRates={null}
        />
      </Suspense>
    </>
  );
}

async function HotelGallery({ hotelCode, locale, country }: { hotelCode: string; locale: Locale; country: string }) {
  await navigation();
  const info = await getHotelInfoCached(hotelCode, country);
  if (!info) return null;
  const images = getHotelGalleryImages(info.imageUrls);
  if (!images.length) return null;
  return <ImageGallery hotelCode={hotelCode} images={images}
    altText={info.name ?? getTranslations(locale).results.hotel.fallbackName} />;
}

async function HotelAmenityContent({ hotelCode, country }: { hotelCode: string; country: string }) {
  await navigation();
  const info = await getHotelInfoCached(hotelCode, country);
  return info?.masterHotelAmenities?.length
    ? <HotelAmenities key={hotelCode} amenities={info.masterHotelAmenities} />
    : null;
}
