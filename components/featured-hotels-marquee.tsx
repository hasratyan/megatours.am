import HotelCard, { type HotelCardCopy } from "@/components/hotel-card";
import { Marquee } from "@/components/ui/marquee";
import type { FeaturedHotelCard } from "@/lib/featured-hotels";
import type { Locale } from "@/lib/i18n";

type Props = {
  featuredHotels: FeaturedHotelCard[];
  locale: Locale;
  cardCopy: HotelCardCopy;
};

export default function FeaturedHotelsMarquee({ featuredHotels, locale, cardCopy }: Props) {
  const seen = new Set<string>();
  const firstRow: FeaturedHotelCard[] = [];
  const secondRow: FeaturedHotelCard[] = [];
  let index = 0;

  for (const hotel of featuredHotels) {
    if (seen.has(hotel.hotelCode)) continue;
    seen.add(hotel.hotelCode);
    if (index % 2 === 0) {
      firstRow.push(hotel);
    } else {
      secondRow.push(hotel);
    }
    index += 1;
  }

  if (firstRow.length === 0 && secondRow.length === 0) return null;

  return (
    <div id="hotels">
      {firstRow.length > 0 && (
        <Marquee reverse pauseOnHover={true}>
          {firstRow.map((hotel) => (
            <HotelCard key={hotel.hotelCode} hotel={hotel} copy={cardCopy} locale={locale} />
          ))}
        </Marquee>
      )}
      {secondRow.length > 0 && (
        <Marquee pauseOnHover={true}>
          {secondRow.map((hotel) => (
            <HotelCard key={hotel.hotelCode} hotel={hotel} copy={cardCopy} locale={locale} />
          ))}
        </Marquee>
      )}
    </div>
  );
}
