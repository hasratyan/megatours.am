import { bypassHotelImageOptimization } from "@/lib/hotel-image";
import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";
import type { FeaturedHotelCard } from "@/lib/featured-hotels";
import type { Locale } from "@/lib/i18n";

export type HotelCardCopy = {
  from: string;
  perNight: string;
  reviews: string;
  cta: string;
};

type Props = {
  hotel: FeaturedHotelCard;
  copy: HotelCardCopy;
  locale: Locale;
};

// const formatPrice = (amount: number, currency: string) =>
//   new Intl.NumberFormat("en", {
//     style: "currency",
//     currency,
//     maximumFractionDigits: 0,
//   }).format(amount);

export default function HotelCard({ hotel, copy, locale }: Props) {
  const hasOldPrice = typeof hotel.oldPrice === "number" && hotel.oldPrice > 0;
  const query = hotel.destinationId === "cyprus" ? `?destinationId=cyprus&countryCode=CY&destinationCode=${encodeURIComponent(hotel.cityId ?? "")}` : "";
  const hotelHref = `/${locale}/hotels/${encodeURIComponent(hotel.hotelCode)}${query}` as Route;

  return (
    <div className="hotel-card">
      <div className="chip-row">
        {hotel.badge && <span className="badge">{hotel.badge}</span>}
        {hotel.availability && <span className="availability">{hotel.availability}</span>}
      </div>
      <div className="image">
        {hotel.image ? <Image unoptimized={bypassHotelImageOptimization(hotel.image)} src={hotel.image} alt={hotel.name} fill sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 100vw" /> : <span className="material-symbols-rounded" aria-hidden="true">hotel</span>}
      </div>
      <div className="content">
        <div className="header">
          <div>
            <h3>{hotel.name}</h3>
            {hotel.location && (
              <p className="location">
                <span className="material-symbols-rounded">location_on</span>
                {hotel.location}
              </p>
            )}
          </div>
          {hotel.rating > 0 ? <span className="rating">{hotel.rating.toFixed(1)} ★</span> : null}
        </div>
        {hotel.perks.length > 0 && (
          <div className="perks">
            {hotel.perks.map((perk) => (
              <span key={perk}>{perk}</span>
            ))}
          </div>
        )}
        <div className="footer">
          <div>
            <p className="price">
              {hotel.priceFrom === null ? {hy:"Ընտրեք ամսաթվերը",en:"Choose your dates",ru:"Выберите даты"}[locale] : <>{copy.from} {hotel.currency}{hotel.priceFrom}{" "}
              {hasOldPrice && (
                <span className="old-price">{hotel.currency}{hotel.oldPrice}</span>
              )}{" "}
              <small>{copy.perNight}</small></>}
            </p>
          </div>
          <Link href={hotelHref}>
            <span className="material-symbols-rounded">notifications_active</span>
            {copy.cta}
          </Link>
        </div>
      </div>
    </div>
  );
}
