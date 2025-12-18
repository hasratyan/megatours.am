"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/header";
import { postJson } from "@/lib/api-helpers";
import { buildSearchQuery, parseSearchParams } from "@/lib/search-query";
import type { AoryxSearchResult } from "@/types/aoryx";
import Image from "next/image";

function formatPrice(value: number | null, currency: string | null): string | null {
  if (value === null || value === undefined) return null;
  const safeCurrency = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${safeCurrency} ${value}`;
  }
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(parsed);
}

export default function ResultsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const parsed = useMemo(
    () => parseSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const [result, setResult] = useState<AoryxSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const missingError = parsed.payload ? null : (parsed.error ?? "Missing search details.");
  const finalError = missingError ?? error;

  useEffect(() => {
    if (!parsed.payload) return;

    queueMicrotask(() => {
      setLoading(true);
      setError(null);
      setResult(null);
    });

    postJson<AoryxSearchResult>("/api/aoryx/search", parsed.payload)
      .then((data) => {
        setResult(data);
        setError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unable to load results right now.";
        setError(message);
        setResult(null);
      })
      .finally(() => setLoading(false));
  }, [parsed.payload]);

  const checkIn = formatDate(parsed.payload?.checkInDate);
  const checkOut = formatDate(parsed.payload?.checkOutDate);
  const totalAdults = parsed.payload?.rooms.reduce((sum, room) => sum + room.adults, 0) ?? 0;
  const totalChildren =
    parsed.payload?.rooms.reduce((sum, room) => sum + room.childrenAges.length, 0) ?? 0;
  const totalGuests = totalAdults + totalChildren;
  const roomsCount = parsed.payload?.rooms.length ?? 0;

  return (
    <>
      <main className="results">
        <div className="container">
          <div className="results-top">
            <section>
              <h1>
                {result?.destination?.name ?? "UAE stays"}
              </h1>
              <p className="section-subtitle">
                {checkIn && checkOut ? `${checkIn} → ${checkOut}` : "Choose dates"}
                {totalGuests > 0 && ` • ${totalGuests} guest${totalGuests === 1 ? "" : "s"}`}
                {totalChildren > 0 &&
                  ` (${totalChildren} child${totalChildren === 1 ? "" : "ren"})`}
                {roomsCount > 0 && ` • ${roomsCount} room${roomsCount === 1 ? "" : "s"}`}
              </p>
            </section>
            <div className="results-actions">
              <Link className="btn" href="/">
                New search
              </Link>
            </div>
          </div>

          {parsed.notice && !finalError && <div className="results-notice">{parsed.notice}</div>}

          {finalError && (
            <div className="results-error">
              <p>{finalError}</p>
              <div className="results-error-actions">
                <Link href="/" className="btn btn-primary">
                  Back to search
                </Link>
              </div>
            </div>
          )}

          {!finalError && (
            <>
              <div className="results-meta">
                {loading && <span>Loading available stays…</span>}
                {!loading && result && (
                  <span>
                    {result.propertyCount ?? result.hotels.length} places found
                  </span>
                )}
              </div>

              {!loading && result && result.hotels.length === 0 && (
                <div className="results-empty">
                  <p>No hotels matched this search. Try adjusting dates or destination.</p>
                </div>
              )}

              <div id="hotels" className="grid">
                {result?.hotels.map((hotel, idx) => {
                  const formattedPrice = formatPrice(hotel.minPrice, hotel.currency ?? result.currency);
                  const detailQuery =
                    parsed.payload && hotel.code
                      ? buildSearchQuery({
                          ...parsed.payload,
                          hotelCode: hotel.code ?? undefined,
                          destinationCode:
                            parsed.payload.destinationCode ?? result?.destination?.code ?? undefined,
                        })
                      : null;
                  const detailHref = detailQuery && hotel.code ? `/hotels/${hotel.code}?${detailQuery}` : null;

                  return (
                    <div className="hotel-card" key={hotel.code ?? hotel.name ?? idx}>
                      <div className="image">
                        {hotel.imageUrl ? (
                          <Image fill sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 100vw" src={hotel.imageUrl} alt={hotel.name ?? "Hotel"}/>
                        ) : (
                          <span>{(hotel.name ?? "Hotel").charAt(0)}</span>
                        )}
                      </div>
                      <div className="content">
                        <div className="header">
                          <div>
                            <h3>{hotel.name ?? "Unnamed hotel"}</h3>
                            <p className="location">
                              <span className="material-symbols-rounded">location_on</span>
                              {hotel.city ?? result?.destination?.name ?? "UAE"}
                            </p>
                          </div>
                          {typeof hotel.rating === "number" && hotel.rating && (
                            <span className="rating">
                              {Number.isInteger(hotel.rating)
                                ? hotel.rating
                                : hotel.rating.toFixed(1)} ★
                            </span>
                          )}
                        </div>
                        <div className="footer">
                          <div>
                            <div className="price">
                              {formattedPrice ? (
                                <>
                                  {formattedPrice} <small>/ night</small>
                                </>
                              ) : (
                                <span className="result-price-muted">Contact for rates</span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!detailHref}
                            onClick={() => detailHref && router.push(detailHref)}
                          >
                            View options
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
