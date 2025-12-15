"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/header";
import SearchForm from "@/components/search-form";
import { postJson } from "@/lib/api-helpers";
import { buildSearchQuery, parseSearchParams } from "@/lib/search-query";
import { useTranslations } from "@/components/language-provider";
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

export default function HotelDetailsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const t = useTranslations();

  const hotelCode = Array.isArray(params.code) ? params.code[0] : params.code;

  const parsed = useMemo(() => {
    const merged = new URLSearchParams(searchParams.toString());
    if (hotelCode) merged.set("hotelCode", hotelCode);
    return parseSearchParams(merged);
  }, [searchParams, hotelCode]);

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
        const message = err instanceof Error ? err.message : "Unable to load this hotel right now.";
        setError(message);
        setResult(null);
      })
      .finally(() => setLoading(false));
  }, [parsed]);

  const currentHotel =
    result?.hotels.find((hotel) => hotel.code === hotelCode) ?? result?.hotels[0] ?? null;
  const formattedPrice = currentHotel
    ? formatPrice(currentHotel.minPrice, currentHotel.currency ?? result?.currency ?? null)
    : null;

  const presetDestination = parsed.payload?.destinationCode
    ? {
        id: parsed.payload.destinationCode,
        label: result?.destination?.name ?? "Selected destination",
        rawId: parsed.payload.destinationCode,
      }
    : undefined;

  const presetHotel = hotelCode
    ? {
        id: hotelCode,
        label: currentHotel?.name ?? "Selected hotel",
      }
    : undefined;

  const initialDateRange = parsed.payload
    ? {
        startDate: new Date(`${parsed.payload.checkInDate}T00:00:00`),
        endDate: new Date(`${parsed.payload.checkOutDate}T00:00:00`),
      }
    : undefined;

  const initialRooms = parsed.payload?.rooms.map((room) => ({
    adults: room.adults,
    children: room.childrenAges.length,
    childAges: room.childrenAges,
  }));

  const backToResultsHref =
    parsed.payload && parsed.payload.destinationCode
      ? `/results?${buildSearchQuery({
          ...parsed.payload,
          hotelCode: undefined,
        })}`
      : "/results";

  return (
    <div className="page results-page">
      <Header />
      <main className="results-main">
        <div className="container hotel-detail">
          <div className="results-top">
            <div>
              <p className="eyebrow" style={{ margin: 0 }}>Hotel details</p>
              <h1 className="section-title font-display" style={{ margin: "6px 0 12px" }}>
                {currentHotel?.name ?? "Selected hotel"}
              </h1>
              <p className="section-subtitle" style={{ margin: 0 }}>
                {currentHotel?.city ?? result?.destination?.name ?? "UAE"}
                {currentHotel?.rating ? ` • ${currentHotel.rating.toFixed(1)} ★` : ""}
              </p>
            </div>
            <div className="results-actions">
              <button className="btn" type="button" onClick={() => router.back()}>
                Go back
              </button>
              <Link className="btn btn-primary" href={backToResultsHref}>
                View all results
              </Link>
            </div>
          </div>

          {error && (
            <div className="results-error">
              <p>{error}</p>
              <div className="results-error-actions">
                <Link href="/" className="btn btn-primary">Back to search</Link>
              </div>
            </div>
          )}

          {!error && (
            <div className="hotel-hero">
              <div
                className="hotel-hero-media"
                style={
                  currentHotel?.imageUrl
                    ? { backgroundImage: `url(${currentHotel.imageUrl})` }
                    : undefined
                }
              >
                {!currentHotel?.imageUrl && (
                  <span className="hotel-hero-fallback">
                    {(currentHotel?.name ?? "Hotel").charAt(0)}
                  </span>
                )}
              </div>
              <div className="hotel-hero-body">
                <p className="section-subtitle" style={{ margin: "0 0 8px" }}>
                  {result?.destination?.name ?? "UAE stay"}
                </p>
                <h2 style={{ margin: "0 0 6px", color: "#fff" }}>
                  {currentHotel?.name ?? "Selected hotel"}
                </h2>
                <p className="result-meta" style={{ margin: 0 }}>
                  {currentHotel?.address ?? currentHotel?.city ?? "Address on request"}
                </p>
                <div className="hotel-hero-meta">
                  {currentHotel?.rating && (
                    <span className="result-rating">{currentHotel.rating.toFixed(1)} ★</span>
                  )}
                  {formattedPrice && <span className="hotel-hero-price">{formattedPrice} / night</span>}
                </div>
                <div className="hotel-hero-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (!parsed.payload || !currentHotel?.code) return;
                      const query = buildSearchQuery({
                        ...parsed.payload,
                        hotelCode: currentHotel.code,
                      });
                      router.push(`/results?${query}`);
                    }}
                  >
                    See similar stays
                  </button>
                </div>
              </div>
            </div>
          )}

          {!error && (
            <div className="hotel-search-card">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>Adjust dates & guests</p>
                <p className="section-subtitle" style={{ margin: "4px 0 12px" }}>
                  The hotel is locked in — update dates or guests to refresh availability.
                </p>
              </div>
              <SearchForm
                copy={t.search}
                hideLocationFields
                presetDestination={presetDestination}
                presetHotel={presetHotel}
                initialDateRange={initialDateRange}
                initialRooms={initialRooms}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
