import type { Locale } from "@/lib/i18n";
import Home from "@/app/[locale]/home";
import { loadAgentCatalog } from "@/lib/catalog/agent-client";
import type { FeaturedHotelCard } from "@/lib/featured-hotels";

export default async function CyprusHome({ locale }: { locale: Locale }) {
  let featuredHotels: FeaturedHotelCard[] = [];
  try {
    const { cities = [] } = await loadAgentCatalog({ resource: "cities" });
    const selected = ["Ayia Napa", "Protaras", "Larnaca", "Paphos"].flatMap((name) => cities.filter((city) => city.name.toLowerCase() === name.toLowerCase()));
    const catalogs = await Promise.all(selected.map(async (city) => ({ city, hotels: (await loadAgentCatalog({ resource: "hotels", cityId: city.id })).hotels ?? [] })));
    featuredHotels = catalogs.flatMap(({ city, hotels }) => [...hotels].sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)) || (b.stars ?? 0) - (a.stars ?? 0)).slice(0, 3).map((hotel) => ({ id: hotel.id, hotelCode: hotel.id, destinationId: "cyprus" as const, cityId: city.id, name: hotel.name, location: hotel.city, rating: hotel.stars ?? 0, image: hotel.image ?? "", perks: [], priceFrom: null, oldPrice: null, currency: "EUR", badge: null, availability: null })));
  } catch (error) { console.error("[CyprusHome] Featured catalogue unavailable", error instanceof Error ? error.message : "Unknown error"); }
  return <Home locale={locale} destination="cyprus" featuredHotels={featuredHotels} />;
}
