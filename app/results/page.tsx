"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/header";
import { postJson } from "@/lib/api-helpers";
import { buildSearchQuery, parseSearchParams } from "@/lib/search-query";
import type { AoryxSearchResult } from "@/types/aoryx";

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

export default function ResultsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const parsed = useMemo(
    () => parseSearchParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  const [result, setResult] = useState<AoryxSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!parsed.payload) {
      setResult(null);
      setError(parsed.error ?? "Missing search details.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

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
  }, [parsed]);

  const checkIn = formatDate(parsed.payload?.checkInDate);
  const checkOut = formatDate(parsed.payload?.checkOutDate);
  const totalAdults = parsed.payload?.rooms.reduce((sum, room) => sum + room.adults, 0) ?? 0;
  const totalChildren = parsed.payload?.rooms.reduce((sum, room) => sum + room.childrenAges.length, 0) ?? 0;
  const totalGuests = totalAdults + totalChildren;
  const roomsCount = parsed.payload?.rooms.length ?? 0;

  return (
    <div className="page results-page">
      <Header />
      <main className="results-main">
        <div className="container">
          <div className="results-top">
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Search results</p>
              <h1 className="section-title font-display" style={{ margin: "6px 0 12px" }}>
                {result?.destination?.name ?? "UAE stays"}
              </h1>
              <p className="section-subtitle" style={{ margin: 0 }}>
                {checkIn && checkOut ? `${checkIn} → ${checkOut}` : "Choose dates"}
                {totalGuests > 0 && ` • ${totalGuests} guest${totalGuests === 1 ? "" : "s"}`}
                {totalChildren > 0 && ` (${totalChildren} child${totalChildren === 1 ? "" : "ren"})`}
                {roomsCount > 0 && ` • ${roomsCount} room${roomsCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="results-actions">
              <Link className="btn" href="/">New search</Link>
            </div>
          </div>

          {parsed.notice && !error && (
            <div className="results-notice">{parsed.notice}</div>
          )}

          {error && (
            <div className="results-error">
              <p>{error}</p>
              <div className="results-error-actions">
                <Link href="/" className="btn btn-primary">Back to search</Link>
              </div>
            </div>
          )}

          {!error && (
            <>
              <div className="results-meta">
                {loading && <span>Loading available stays…</span>}
                {!loading && result && (
                  <span>
                    {result.propertyCount ?? result.hotels.length} places found
                    {result.responseTime ? ` • ${result.responseTime}` : ""}
                  </span>
                )}
              </div>

              {!loading && result && result.hotels.length === 0 && (
                <div className="results-empty">
                  <p>No hotels matched this search. Try adjusting dates or destination.</p>
                </div>
              )}

              <div className="results-grid">
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
                  const detailHref =
                    detailQuery && hotel.code ? `/hotels/${hotel.code}?${detailQuery}` : null;

                  return (
                    <article className="result-card" key={hotel.code ?? hotel.name ?? idx}>
                      <div
                        className="result-thumb"
                        style={hotel.imageUrl ? { backgroundImage: `url(${hotel.imageUrl})` } : undefined}
                      >
                        {!hotel.imageUrl && <span>{(hotel.name ?? "Hotel").charAt(0)}</span>}
                      </div>
                      <div className="result-body">
                        <div className="result-row">
                          <h3>{hotel.name ?? "Unnamed hotel"}</h3>
                          {typeof hotel.rating === "number" && (
                            <span className="result-rating">{hotel.rating.toFixed(1)} ★</span>
                          )}
                        </div>
                        <p className="result-meta">
                          {hotel.city ?? result?.destination?.name ?? "UAE"}
                        </p>
                        {hotel.address && <p className="result-address">{hotel.address}</p>}
                        <div className="result-footer">
                          <div className="result-price">
                            {formattedPrice ? (
                              <>
                                {formattedPrice} <small>/ night</small>
                              </>
                            ) : (
                              <span className="result-price-muted">Contact for rates</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!detailHref}
                            onClick={() => detailHref && router.push(detailHref)}
                          >
                            View options
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
