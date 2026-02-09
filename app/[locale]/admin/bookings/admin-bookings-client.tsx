"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLanguage, useTranslations } from "@/components/language-provider";
import type { Locale } from "@/lib/i18n";
import { resolveBookingStatusKey, type BookingStatusKey } from "@/lib/booking-status";
import { ApiError, postJson } from "@/lib/api-helpers";
import type { AoryxBookingPayload, AoryxBookingResult } from "@/types/aoryx";

type AdminBookingRecord = {
  id: string;
  createdAt: string | null;
  userIdString: string | null;
  userName: string | null;
  userEmail: string | null;
  source: string | null;
  payload: AoryxBookingPayload | null;
  booking: AoryxBookingResult | null;
  refundState?: string | null;
  displayTotal?: number | null;
  displayCurrency?: string | null;
  displayNet?: number | null;
  displayNetCurrency?: string | null;
  displayProfit?: number | null;
  displayProfitCurrency?: string | null;
};

type AdminBookingsClientProps = {
  adminUser: { name?: string | null; email?: string | null };
  initialBookings: AdminBookingRecord[];
};

type CancelBookingResponse = {
  message?: string;
  bookingStatus?: string | null;
  refund?: {
    status?: string | null;
  } | null;
};

const ADMIN_BOOKINGS_COLUMN_COUNT = 12;

const intlLocales: Record<Locale, string> = {
  hy: "hy-AM",
  en: "en-GB",
  ru: "ru-RU",
};

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseSearchDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: string | null | undefined, locale: string) => {
  const parsed = parseDate(value ?? null);
  if (!parsed) return null;
  if (locale.startsWith("hy")) {
    const months = ["հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];
    const day = parsed.getDate().toString().padStart(2, "0");
    const month = months[parsed.getMonth()];
    return `${day} ${month}, ${parsed.getFullYear()} թ.`;
  }
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
};

const formatDateRange = (start?: string | null, end?: string | null, locale?: string) => {
  const parsedStart = parseSearchDate(start ?? null);
  const parsedEnd = parseSearchDate(end ?? null);
  if (!parsedStart || !parsedEnd || !locale) return null;
  if (locale.startsWith("hy")) {
    const months = ["հնվ", "փտվ", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];
    const startDay = parsedStart.getDate().toString().padStart(2, "0");
    const endDay = parsedEnd.getDate().toString().padStart(2, "0");
    const startMonth = months[parsedStart.getMonth()];
    const endMonth = months[parsedEnd.getMonth()];
    return `${startDay} ${startMonth} — ${endDay} ${endMonth}`;
  }
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return `${formatter.format(parsedStart)} — ${formatter.format(parsedEnd)}`;
};

const formatPrice = (amount: number, currency: string, locale: string) => {
  const safeCurrency = currency.trim().toUpperCase();
  try {
    const formattedNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
    if (safeCurrency === "AMD") return `${formattedNumber} ֏`;
    if (safeCurrency === "USD") return `$${formattedNumber}`;
    if (safeCurrency === "EUR") return `€${formattedNumber}`;
    return `${formattedNumber} ${safeCurrency}`;
  } catch {
    return `${safeCurrency} ${amount}`;
  }
};

const countGuestsFromRooms = (rooms: Array<{ adults: number; childrenAges: number[] }>) =>
  rooms.reduce((sum, room) => sum + room.adults + room.childrenAges.length, 0);

const normalizeText = (value: string) => value.trim().toLowerCase();

const resolveRefundStateKey = (value?: string | null) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "already_refunded") return "already_refunded";
  if (normalized.includes("refunded")) return "refunded";
  if (
    normalized.includes("in_progress") ||
    normalized.includes("requested") ||
    normalized.includes("processing")
  ) {
    return "in_progress";
  }
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  return "unknown";
};

const REFUND_LABELS: Record<
  "refunded" | "already_refunded" | "in_progress" | "failed" | "unknown",
  string
> = {
  refunded: "Refunded",
  already_refunded: "Already refunded",
  in_progress: "Refund in progress",
  failed: "Refund failed",
  unknown: "Refund",
};

export default function AdminBookingsClient({
  adminUser,
  initialBookings,
}: AdminBookingsClientProps) {
  const t = useTranslations();
  const { locale } = useLanguage();
  const intlLocale = intlLocales[locale] ?? "en-GB";
  const [bookings, setBookings] = useState(initialBookings);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BookingStatusKey | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [cancelingBookingId, setCancelingBookingId] = useState<string | null>(null);
  const [cancelFeedback, setCancelFeedback] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setBookings(initialBookings);
  }, [initialBookings]);

  const sources = useMemo(() => {
    const values = new Set<string>();
    bookings.forEach((booking) => {
      if (booking.source && booking.source.trim().length > 0) {
        values.add(booking.source.trim());
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [bookings]);

  const normalizedQuery = normalizeText(query);

  const filteredBookings = useMemo(() => {
    const entries = bookings.map((entry) => {
      const payload = entry.payload;
      const booking = entry.booking;
      const total =
        typeof entry.displayTotal === "number" ? entry.displayTotal : null;
      const totalCurrency = entry.displayCurrency ?? payload?.currency ?? "USD";
      const net =
        typeof entry.displayNet === "number" ? entry.displayNet : null;
      const netCurrency = entry.displayNetCurrency ?? totalCurrency;
      const profit =
        typeof entry.displayProfit === "number" ? entry.displayProfit : null;
      const profitCurrency = entry.displayProfitCurrency ?? totalCurrency;
      const guestsCount = payload ? countGuestsFromRooms(payload.rooms) : 0;
      const statusKey = resolveBookingStatusKey(booking?.status ?? null);
      const createdTimestamp = entry.createdAt ? parseDate(entry.createdAt)?.getTime() ?? 0 : 0;
      const searchParts = [
        payload?.hotelName,
        payload?.hotelCode,
        payload?.destinationCode,
        payload?.customerRefNumber,
        booking?.customerRefNumber,
        booking?.hotelConfirmationNumber,
        booking?.supplierConfirmationNumber,
        booking?.adsConfirmationNumber,
        entry.userEmail,
        entry.userName,
        entry.userIdString,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        entry,
        payload,
        booking,
        total,
        totalCurrency,
        net,
        netCurrency,
        profit,
        profitCurrency,
        guestsCount,
        statusKey,
        createdTimestamp,
        searchParts,
      };
    });

    const filtered = entries.filter((item) => {
      if (statusFilter !== "all" && item.statusKey !== statusFilter) return false;
      if (sourceFilter !== "all") {
        const source = item.entry.source?.trim() ?? "";
        if (!source || source !== sourceFilter) return false;
      }
      if (normalizedQuery.length > 0 && !item.searchParts.includes(normalizedQuery)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "oldest") return a.createdTimestamp - b.createdTimestamp;
      if (sortBy === "totalHigh") return (b.total ?? 0) - (a.total ?? 0);
      if (sortBy === "totalLow") return (a.total ?? 0) - (b.total ?? 0);
      return b.createdTimestamp - a.createdTimestamp;
    });

    return filtered;
  }, [bookings, normalizedQuery, sortBy, sourceFilter, statusFilter]);

  const stats = useMemo(() => {
    const counts: Record<BookingStatusKey, number> = {
      confirmed: 0,
      pending: 0,
      failed: 0,
      unknown: 0,
    };
    let totalGuests = 0;
    filteredBookings.forEach((item) => {
      counts[item.statusKey] += 1;
      totalGuests += item.guestsCount;
    });
    return {
      totalBookings: filteredBookings.length,
      totalGuests,
      counts,
    };
  }, [filteredBookings]);

  const formatDateSafe = (value: string | null | undefined) =>
    hydrated ? formatDate(value ?? null, intlLocale) : null;
  const formatDateRangeSafe = (start?: string | null, end?: string | null) =>
    hydrated ? formatDateRange(start, end, intlLocale) : null;

  const handleReset = () => {
    setQuery("");
    setStatusFilter("all");
    setSourceFilter("all");
    setSortBy("newest");
    setExpandedBookingId(null);
  };

  const handleCancelAndRefund = async (bookingId: string) => {
    if (!bookingId || cancelingBookingId) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(t.admin.actions.confirmCancelAndRefund);
      if (!confirmed) return;
    }

    setCancelingBookingId(bookingId);
    setCancelFeedback((prev) => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });

    try {
      const response = await postJson<CancelBookingResponse>(
        `/api/admin/bookings/${encodeURIComponent(bookingId)}/cancel`,
        {}
      );
      const message =
        typeof response.message === "string" && response.message.trim().length > 0
          ? response.message
          : t.admin.actions.cancelAndRefundSuccess;
      const bookingStatus =
        typeof response.bookingStatus === "string" && response.bookingStatus.trim().length > 0
          ? response.bookingStatus
          : "4";

      setBookings((prev) =>
        prev.map((entry) =>
          entry.id === bookingId
            ? {
                ...entry,
                booking: entry.booking
                  ? {
                      ...entry.booking,
                      status: bookingStatus,
                    }
                  : entry.booking,
                refundState:
                  typeof response.refund?.status === "string" && response.refund.status.trim().length > 0
                    ? response.refund.status
                    : entry.refundState ?? "refunded",
              }
            : entry
        )
      );
      setCancelFeedback((prev) => ({
        ...prev,
        [bookingId]: { ok: true, message },
      }));
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t.admin.actions.cancelAndRefundFailed;
      setCancelFeedback((prev) => ({
        ...prev,
        [bookingId]: { ok: false, message },
      }));
    } finally {
      setCancelingBookingId(null);
    }
  };

  return (
    <>
      <section className="admin-hero">
        <div>
          <span className="admin-eyebrow">{t.admin.title}</span>
          <h1 className="admin-title">{t.admin.bookings.title}</h1>
          <p className="admin-subtitle">{t.admin.subtitle}</p>
        </div>
        <div className="admin-user">
          <span>{adminUser.name ?? adminUser.email ?? t.auth.guestNameFallback}</span>
          {adminUser.email && <small>{adminUser.email}</small>}
        </div>
      </section>

      <section className="admin-stats">
        <div className="admin-stat">
          <p>{t.admin.stats.totalBookings}</p>
          <strong>{stats.totalBookings}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.stats.totalGuests}</p>
          <strong>{stats.totalGuests}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.stats.confirmed}</p>
          <strong>{stats.counts.confirmed}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.stats.pending}</p>
          <strong>{stats.counts.pending}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.stats.failed}</p>
          <strong>{stats.counts.failed}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.stats.unknown}</p>
          <strong>{stats.counts.unknown}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>{t.admin.bookings.title}</h2>
            <p>{t.admin.bookings.subtitle}</p>
          </div>
          <div className="admin-controls">
            <label className="admin-control">
              <span>{t.admin.filters.searchPlaceholder}</span>
              <input
                type="search"
                value={query}
                placeholder={t.admin.filters.searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="admin-control">
              <span>{t.admin.filters.statusLabel}</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BookingStatusKey | "all")}>
                <option value="all">{t.admin.filters.all}</option>
                <option value="confirmed">{t.profile.bookings.status.confirmed}</option>
                <option value="pending">{t.profile.bookings.status.pending}</option>
                <option value="failed">{t.profile.bookings.status.failed}</option>
                <option value="unknown">{t.profile.bookings.status.unknown}</option>
              </select>
            </label>
            <label className="admin-control">
              <span>{t.admin.filters.sourceLabel}</span>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                <option value="all">{t.admin.filters.all}</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-control">
              <span>{t.admin.filters.sortLabel}</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="newest">{t.admin.filters.sortOptions.newest}</option>
                <option value="oldest">{t.admin.filters.sortOptions.oldest}</option>
                <option value="totalHigh">{t.admin.filters.sortOptions.totalHigh}</option>
                <option value="totalLow">{t.admin.filters.sortOptions.totalLow}</option>
              </select>
            </label>
            <button type="button" className="admin-reset" onClick={handleReset}>
              {t.admin.filters.reset}
            </button>
          </div>
        </div>

        {filteredBookings.length === 0 ? (
          <div className="profile-empty">
            <h3>{t.admin.bookings.emptyTitle}</h3>
            <p>{t.admin.bookings.emptyBody}</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t.admin.columns.bookingId}</th>
                  <th>{t.admin.columns.hotel}</th>
                  <th>{t.admin.columns.user}</th>
                  <th>{t.admin.columns.dates}</th>
                  <th>{t.admin.columns.guests}</th>
                  <th>{t.admin.columns.total}</th>
                  <th>{t.admin.columns.net}</th>
                  <th>{t.admin.columns.profit}</th>
                  <th>{t.admin.columns.status}</th>
                  <th>{t.admin.columns.createdAt}</th>
                  <th>{t.admin.columns.source}</th>
                  <th>{t.admin.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBookings.map((item) => {
                  const payload = item.payload;
                  const booking = item.booking;
                  const statusLabel = t.profile.bookings.status[item.statusKey];
                  const isCanceling = cancelingBookingId === item.entry.id;
                  const isExpanded = expandedBookingId === item.entry.id;
                  const isVposSource = (item.entry.source ?? "").toLowerCase().includes("vpos");
                  const canCancelAndRefund = item.statusKey === "confirmed" && isVposSource;
                  const actionFeedback = cancelFeedback[item.entry.id] ?? null;
                  const refundStateKey = resolveRefundStateKey(item.entry.refundState);
                  const refundLabel = refundStateKey ? REFUND_LABELS[refundStateKey] : null;
                  const totalLabel =
                    payload && item.total !== null
                      ? formatPrice(item.total, item.totalCurrency, intlLocale)
                      : "—";
                  const netLabel =
                    payload && item.net !== null
                      ? formatPrice(item.net, item.netCurrency, intlLocale)
                      : "—";
                  const profitLabel =
                    payload && item.profit !== null
                      ? formatPrice(item.profit, item.profitCurrency, intlLocale)
                      : "—";
                  const bookingId =
                    payload?.customerRefNumber ??
                    booking?.customerRefNumber ??
                    "—";
                  const confirmation =
                    booking?.hotelConfirmationNumber ??
                    booking?.supplierConfirmationNumber ??
                    booking?.adsConfirmationNumber ??
                    "—";
                  const dateRange = payload
                    ? formatDateRangeSafe(payload.checkInDate, payload.checkOutDate)
                    : null;
                  const createdLabel = formatDateSafe(item.entry.createdAt);
                  const hotelLabel = payload?.hotelName ?? payload?.hotelCode ?? "—";
                  const userLabel =
                    item.entry.userName ??
                    item.entry.userEmail ??
                    item.entry.userIdString ??
                    "—";
                  return (
                    <Fragment key={item.entry.id}>
                      <tr>
                        <td>{bookingId}</td>
                        <td>
                          <div className="admin-cell-stack">
                            <span>{hotelLabel}</span>
                            {payload?.hotelCode && (
                              <small>{payload.hotelCode}</small>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="admin-cell-stack">
                            <span>{userLabel}</span>
                            {item.entry.userEmail && item.entry.userName && (
                              <small>{item.entry.userEmail}</small>
                            )}
                          </div>
                        </td>
                        <td>{dateRange ?? "—"}</td>
                        <td>{item.guestsCount}</td>
                        <td>{totalLabel}</td>
                        <td>{netLabel}</td>
                        <td>{profitLabel}</td>
                        <td>
                          <div className="admin-status-stack">
                            <span className={`status-chip status-${item.statusKey}`}>{statusLabel}</span>
                            {refundStateKey && (
                              <span className={`refund-chip refund-${refundStateKey}`}>{refundLabel}</span>
                            )}
                          </div>
                        </td>
                        <td>{createdLabel ?? "—"}</td>
                        <td>{item.entry.source ?? "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-detail-toggle"
                            onClick={() =>
                              setExpandedBookingId((current) =>
                                current === item.entry.id ? null : item.entry.id
                              )
                            }
                            aria-expanded={isExpanded}
                          >
                            {t.admin.actions.details}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="admin-detail-row">
                          <td colSpan={ADMIN_BOOKINGS_COLUMN_COUNT}>
                            <div className="admin-detail-body">
                              <div className="admin-detail-grid">
                                <div>
                                  <span>{t.profile.bookings.labels.confirmation}</span>
                                  <strong>{confirmation}</strong>
                                </div>
                                <div>
                                  <span>{t.profile.bookings.labels.rooms}</span>
                                  <strong>{payload?.rooms.length ?? 0}</strong>
                                </div>
                                <div>
                                  <span>{t.profile.bookings.labels.destination}</span>
                                  <strong>{payload?.destinationCode ?? "—"}</strong>
                                </div>
                                <div>
                                  <span>{t.profile.bookings.labels.bookedOn}</span>
                                  <strong>{createdLabel ?? "—"}</strong>
                                </div>
                                <div>
                                  <span>{t.admin.columns.net}</span>
                                  <strong>{netLabel}</strong>
                                </div>
                                <div>
                                  <span>{t.admin.columns.profit}</span>
                                  <strong>{profitLabel}</strong>
                                </div>
                              </div>
                              <div className="admin-json-grid">
                                <div>
                                  <span>{t.admin.details.payload}</span>
                                  <pre>{JSON.stringify(payload, null, 2)}</pre>
                                </div>
                                <div>
                                  <span>{t.admin.details.booking}</span>
                                  <pre>{JSON.stringify(booking, null, 2)}</pre>
                                </div>
                              </div>
                              {payload?.hotelCode && (
                                <Link className="profile-link" href={`/${locale}/hotels/${payload.hotelCode}`}>
                                  {t.profile.bookings.viewHotel}
                                </Link>
                              )}
                              {canCancelAndRefund && (
                                <div className="admin-action-row">
                                  <button
                                    type="button"
                                    className="admin-danger"
                                    onClick={() => handleCancelAndRefund(item.entry.id)}
                                    disabled={isCanceling}
                                  >
                                    {isCanceling
                                      ? t.admin.actions.cancelAndRefundLoading
                                      : t.admin.actions.cancelAndRefund}
                                  </button>
                                  {actionFeedback && (
                                    <p className={actionFeedback.ok ? "admin-inline-success" : "admin-inline-error"}>
                                      {actionFeedback.message}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
