import type { MetadataRoute } from "next";
import { destinationSlugs } from "@/lib/destination-data";
import { getFeaturedHotelSelections } from "@/lib/featured-hotels";
import { defaultLocale, locales } from "@/lib/i18n";

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

const baseUrl = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000",
);

type RouteDefinition = {
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
};

const servicePaths = [
  "/services/hotel",
  "/services/flight",
  "/services/transfer",
  "/services/excursion",
  "/services/insurance",
] as const;

const routeDefinitions: RouteDefinition[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/services", priority: 0.8, changeFrequency: "weekly" },
  ...servicePaths.map((path) => ({ path, priority: 0.7, changeFrequency: "weekly" as const })),
  ...destinationSlugs.map((slug) => ({ path: `/${slug}`, priority: 0.85, changeFrequency: "weekly" as const })),
  { path: "/refund-policy", priority: 0.4, changeFrequency: "monthly" },
  { path: "/privacy-policy", priority: 0.4, changeFrequency: "monthly" },
];

async function loadFeaturedHotelRouteDefinitions(): Promise<RouteDefinition[]> {
  try {
    const selections = await getFeaturedHotelSelections();
    const seen = new Set<string>();
    return selections
      .map((selection) => selection.hotelCode.trim())
      .filter((hotelCode) => {
        if (!hotelCode || seen.has(hotelCode)) return false;
        seen.add(hotelCode);
        return true;
      })
      .map((hotelCode) => ({
        path: `/hotels/${hotelCode}`,
        priority: 0.75,
        changeFrequency: "daily" as const,
      }));
  } catch (error) {
    console.warn("[Sitemap] Failed to load featured hotel routes", error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const allRoutes = [...routeDefinitions, ...(await loadFeaturedHotelRouteDefinitions())];
  return allRoutes.flatMap((route) => {
    const alternates = {
      languages: Object.fromEntries(
        [
          ...locales.map((locale) => [locale, `${baseUrl}/${locale}${route.path}`]),
          ["x-default", `${baseUrl}/${defaultLocale}${route.path}`],
        ],
      ),
    };

    return locales.map((locale) => ({
      url: `${baseUrl}/${locale}${route.path}`,
      lastModified,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates,
    }));
  });
}
