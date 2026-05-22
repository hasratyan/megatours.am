import type { DestinationData } from "@/lib/destination-data";
import type { FeaturedHotelCard } from "@/lib/featured-hotels";
import { defaultLocale, type Locale } from "@/lib/i18n";
import { metadataBase, siteName, toAbsoluteUrl } from "@/lib/metadata";
import type { AoryxHotelInfoResult } from "@/types/aoryx";

type BreadcrumbItem = {
  name: string;
  path: string;
};

type FaqItem = {
  title: string;
  body: string;
};

const localeCodes: Record<Locale, string> = {
  hy: "hy-AM",
  en: "en",
  ru: "ru",
};

const travelAgencyDescriptions: Record<Locale, string> = {
  hy: "MEGATOURS-ը տուրօպերատոր է, որը տրամադրում է ԱՄԷ հյուրանոցների, տրանսֆերների, էքսկուրսիաների, ավիատոմսերի և ապահովագրության ամրագրում:",
  en: "MEGATOURS is a tour operator for UAE hotel bookings, transfers, excursions, flights, and travel insurance.",
  ru: "MEGATOURS — туроператор для бронирования отелей ОАЭ, трансферов, экскурсий, авиабилетов и туристической страховки.",
};

const homeLabels: Record<Locale, string> = {
  hy: "Գլխավոր",
  en: "Home",
  ru: "Главная",
};

export const getLanguageCode = (locale: Locale) => localeCodes[locale] ?? localeCodes[defaultLocale];

export function buildBreadcrumbStructuredData(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.path),
    })),
  };
}

export function buildFaqStructuredData(faqs: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.title,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.body,
      },
    })),
  };
}

export function buildTravelAgencyStructuredData(locale: Locale) {
  const siteUrl = metadataBase.toString().replace(/\/+$/, "");

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TravelAgency",
        "@id": `${siteUrl}/#organization`,
        name: siteName,
        alternateName: "Megatours Armenia",
        url: siteUrl,
        image: toAbsoluteUrl("/images/ogimage.jpg"),
        description: travelAgencyDescriptions[locale],
        telephone: "+37455659965",
        email: "support@megatours.am",
        areaServed: [
          { "@type": "Country", name: "United Arab Emirates" },
          { "@type": "Country", name: "Armenia" },
        ],
        knowsAbout: [
          "UAE hotels",
          "Dubai hotels",
          "Abu Dhabi hotels",
          "Sharjah hotels",
          "airport transfers",
          "UAE excursions",
          "travel insurance",
        ],
        sameAs: [
          "https://www.facebook.com/megatours.am",
          "https://www.instagram.com/megatours.am",
          "https://t.me/megatours_am",
        ],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          telephone: "+37455659965",
          email: "support@megatours.am",
          availableLanguage: ["hy", "en", "ru"],
        },
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        name: siteName,
        url: siteUrl,
        publisher: { "@id": `${siteUrl}/#organization` },
        inLanguage: getLanguageCode(locale),
      },
    ],
  };
}

export function buildHomeStructuredData({
  locale,
  title,
  description,
  path,
  faqs,
  featuredHotels,
}: {
  locale: Locale;
  title: string;
  description: string;
  path: string;
  faqs: FaqItem[];
  featuredHotels: FeaturedHotelCard[];
}) {
  const pageUrl = toAbsoluteUrl(path);
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebPage",
      "@id": `${pageUrl}#webpage`,
      url: pageUrl,
      name: title,
      description,
      isPartOf: { "@id": `${metadataBase.toString().replace(/\/+$/, "")}/#website` },
      about: [
        { "@id": `${metadataBase.toString().replace(/\/+$/, "")}/#organization` },
        { "@type": "Thing", name: "UAE hotels" },
        { "@type": "Place", name: "United Arab Emirates" },
      ],
      inLanguage: getLanguageCode(locale),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: homeLabels[locale],
          item: pageUrl,
        },
      ],
    },
    buildFaqStructuredData(faqs),
  ];

  if (featuredHotels.length > 0) {
    graph.push({
      "@type": "ItemList",
      name: `${siteName} featured UAE hotels`,
      itemListElement: featuredHotels.map((hotel, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: toAbsoluteUrl(`/${locale}/hotels/${hotel.hotelCode}`),
        item: {
          "@type": "Hotel",
          name: hotel.name,
          image: toAbsoluteUrl(hotel.image),
          address: hotel.location
            ? {
                "@type": "PostalAddress",
                addressLocality: hotel.location,
                addressCountry: "AE",
              }
            : undefined,
          starRating:
            hotel.rating > 0
              ? {
                  "@type": "Rating",
                  ratingValue: hotel.rating,
                  bestRating: 5,
                }
              : undefined,
        },
      })),
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}

export function buildDestinationStructuredData({
  locale,
  destination,
}: {
  locale: Locale;
  destination: DestinationData;
}) {
  const path = `/${locale}/${destination.slug}`;
  const pageUrl = toAbsoluteUrl(path);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: destination.heroTitle[locale],
        description: destination.heroSummary[locale],
        inLanguage: getLanguageCode(locale),
        about: {
          "@type": "TouristDestination",
          name: destination.name[locale],
          description: destination.heroSummary[locale],
          image: toAbsoluteUrl(destination.heroImage),
          address: {
            "@type": "PostalAddress",
            addressLocality: destination.name.en,
            addressCountry: "AE",
          },
        },
      },
      buildBreadcrumbStructuredData([
        { name: homeLabels[locale], path: `/${locale}` },
        { name: destination.name[locale], path },
      ]),
      {
        "@type": "ItemList",
        name: destination.hotelsTitle[locale],
        itemListElement: destination.hotels.slice(0, 6).map((hotel, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Hotel",
            name: hotel.name,
            image: toAbsoluteUrl(hotel.image),
            description: hotel.description[locale],
            address: {
              "@type": "PostalAddress",
              addressLocality: hotel.area.en,
              addressCountry: "AE",
            },
            starRating: {
              "@type": "Rating",
              ratingValue: hotel.rating,
              bestRating: 5,
            },
          },
        })),
      },
    ],
  };
}

export function buildHotelStructuredData({
  locale,
  hotel,
  path,
}: {
  locale: Locale;
  hotel: AoryxHotelInfoResult;
  path: string;
}) {
  const name = hotel.name?.trim();
  if (!name) return null;

  const pageUrl = toAbsoluteUrl(path);
  const images = (hotel.imageUrls.length > 0 ? hotel.imageUrls : hotel.imageUrl ? [hotel.imageUrl] : []).map(
    toAbsoluteUrl
  );

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Hotel",
        "@id": `${pageUrl}#hotel`,
        name,
        url: pageUrl,
        image: images,
        inLanguage: getLanguageCode(locale),
        address: hotel.address
          ? {
              "@type": "PostalAddress",
              streetAddress: [hotel.address.line1, hotel.address.line2].filter(Boolean).join(", ") || undefined,
              addressLocality: hotel.address.cityName ?? hotel.destinationName ?? undefined,
              addressRegion: hotel.address.stateCode ?? undefined,
              postalCode: hotel.address.zipCode ?? undefined,
              addressCountry: hotel.address.countryCode ?? "AE",
            }
          : hotel.destinationName
            ? {
                "@type": "PostalAddress",
                addressLocality: hotel.destinationName,
                addressCountry: "AE",
              }
            : undefined,
        geo:
          typeof hotel.geoCode?.lat === "number" && typeof hotel.geoCode?.lon === "number"
            ? {
                "@type": "GeoCoordinates",
                latitude: hotel.geoCode.lat,
                longitude: hotel.geoCode.lon,
              }
            : undefined,
        telephone: hotel.contact?.phone ?? undefined,
        starRating:
          hotel.rating !== null
            ? {
                "@type": "Rating",
                ratingValue: hotel.rating,
                bestRating: 5,
              }
            : undefined,
        amenityFeature:
          hotel.masterHotelAmenities?.slice(0, 20).map((amenity) => ({
            "@type": "LocationFeatureSpecification",
            name: amenity,
            value: true,
          })) ?? undefined,
      },
      buildBreadcrumbStructuredData([
        { name: homeLabels[locale], path: `/${locale}` },
        { name, path },
      ]),
    ],
  };
}
