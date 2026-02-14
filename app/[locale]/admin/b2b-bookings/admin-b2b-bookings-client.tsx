"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useLanguage, useTranslations } from "@/components/language-provider";
import type { Locale } from "@/lib/i18n";
import { postJson } from "@/lib/api-helpers";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";

type B2bServiceStatus = "skipped" | "booked" | "failed";
type B2bReviewStatus = "new" | "in_progress" | "needs_followup" | "resolved";

type B2bServiceResult = {
  status?: B2bServiceStatus | string | null;
  referenceId?: string | null;
  message?: string | null;
  items?: number | null;
  provider?: string | null;
  policies?: unknown[] | null;
} | null;

type AdminB2bServiceBookingRecord = {
  id: string;
  createdAt: string | null;
  requestId: string | null;
  clientId: string | null;
  customerRefNumber: string | null;
  hotelCode: string | null;
  destinationCode: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  bookingResult: unknown;
  servicesPayload: unknown;
  servicesResult: {
    transfer: B2bServiceResult;
    excursions: B2bServiceResult;
    insurance: B2bServiceResult;
  };
  review: {
    status: B2bReviewStatus;
    note: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  };
};

type AdminB2bBookingsClientProps = {
  adminUser: { name?: string | null; email?: string | null };
  initialBookings: AdminB2bServiceBookingRecord[];
};

type ManageBookingResponse = {
  message?: string;
  review?: {
    status?: B2bReviewStatus;
    note?: string | null;
    updatedBy?: string | null;
    updatedAt?: string | null;
  } | null;
};

type ReviewDraft = {
  status: B2bReviewStatus;
  note: string;
};

type ServiceFilter =
  | "all"
  | "any_failed"
  | "transfer_failed"
  | "excursions_failed"
  | "insurance_failed";

const ADMIN_B2B_BOOKINGS_COLUMN_COUNT = 7;

const intlLocales: Record<Locale, string> = {
  hy: "hy-AM",
  en: "en-GB",
  ru: "ru-RU",
};

const reviewStatuses: readonly B2bReviewStatus[] = [
  "new",
  "in_progress",
  "needs_followup",
  "resolved",
];

const parseDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDate = (value: string | null | undefined, locale: string) => {
  const parsed = parseDate(value ?? null);
  if (!parsed) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
};

const normalizeText = (value: string) => value.trim().toLowerCase();

const resolveServiceStatus = (value: unknown): B2bServiceStatus => {
  if (typeof value !== "string") return "skipped";
  const normalized = value.trim().toLowerCase();
  if (normalized === "booked" || normalized === "failed" || normalized === "skipped") {
    return normalized;
  }
  return "skipped";
};

const resolveReviewStatus = (value: unknown): B2bReviewStatus => {
  if (typeof value !== "string") return "new";
  const normalized = value.trim().toLowerCase();
  return reviewStatuses.includes(normalized as B2bReviewStatus)
    ? (normalized as B2bReviewStatus)
    : "new";
};

const hasAnyServiceFailed = (entry: AdminB2bServiceBookingRecord) =>
  [
    resolveServiceStatus(entry.servicesResult.transfer?.status),
    resolveServiceStatus(entry.servicesResult.excursions?.status),
    resolveServiceStatus(entry.servicesResult.insurance?.status),
  ].some((status) => status === "failed");

const truncateText = (value: string | null | undefined, maxLength = 64) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
};

export default function AdminB2bBookingsClient({
  adminUser,
  initialBookings,
}: AdminB2bBookingsClientProps) {
  const t = useTranslations();
  const { locale } = useLanguage();
  const intlLocale = intlLocales[locale] ?? "en-GB";

  const [bookings, setBookings] = useState(initialBookings);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState<B2bReviewStatus | "all">("all");
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savingBookingId, setSavingBookingId] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    setBookings(initialBookings);
  }, [initialBookings]);

  useEffect(() => {
    const nextDrafts: Record<string, ReviewDraft> = {};
    initialBookings.forEach((entry) => {
      nextDrafts[entry.id] = {
        status: resolveReviewStatus(entry.review.status),
        note: entry.review.note ?? "",
      };
    });
    setDrafts(nextDrafts);
  }, [initialBookings]);

  const partners = useMemo(() => {
    const values = new Set<string>();
    bookings.forEach((booking) => {
      if (booking.clientId && booking.clientId.trim().length > 0) {
        values.add(booking.clientId.trim());
      }
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [bookings]);

  const normalizedQuery = normalizeText(query);

  const filteredBookings = useMemo(() => {
    const entries = bookings.map((entry) => {
      const transferStatus = resolveServiceStatus(entry.servicesResult.transfer?.status);
      const excursionsStatus = resolveServiceStatus(entry.servicesResult.excursions?.status);
      const insuranceStatus = resolveServiceStatus(entry.servicesResult.insurance?.status);
      const reviewStatus = resolveReviewStatus(entry.review.status);
      const createdTimestamp = entry.createdAt ? parseDate(entry.createdAt)?.getTime() ?? 0 : 0;
      const searchParts = [
        entry.requestId,
        entry.clientId,
        entry.customerRefNumber,
        entry.hotelCode,
        entry.destinationCode,
        entry.servicesResult.transfer?.referenceId,
        entry.servicesResult.excursions?.referenceId,
        entry.servicesResult.insurance?.referenceId,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .toLowerCase();

      return {
        entry,
        transferStatus,
        excursionsStatus,
        insuranceStatus,
        reviewStatus,
        createdTimestamp,
        searchParts,
      };
    });

    const filtered = entries.filter((item) => {
      if (partnerFilter !== "all") {
        const partner = item.entry.clientId?.trim() ?? "";
        if (!partner || partner !== partnerFilter) return false;
      }

      if (reviewFilter !== "all" && item.reviewStatus !== reviewFilter) return false;

      if (serviceFilter === "any_failed") {
        if (
          item.transferStatus !== "failed" &&
          item.excursionsStatus !== "failed" &&
          item.insuranceStatus !== "failed"
        ) {
          return false;
        }
      }

      if (serviceFilter === "transfer_failed" && item.transferStatus !== "failed") return false;
      if (serviceFilter === "excursions_failed" && item.excursionsStatus !== "failed") return false;
      if (serviceFilter === "insurance_failed" && item.insuranceStatus !== "failed") return false;

      if (normalizedQuery.length > 0 && !item.searchParts.includes(normalizedQuery)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "oldest") return a.createdTimestamp - b.createdTimestamp;
      return b.createdTimestamp - a.createdTimestamp;
    });

    return filtered;
  }, [bookings, normalizedQuery, partnerFilter, reviewFilter, serviceFilter, sortBy]);

  const stats = useMemo(() => {
    const uniquePartners = new Set<string>();
    let openCount = 0;
    let resolvedCount = 0;
    let failedServiceCount = 0;

    filteredBookings.forEach((item) => {
      if (item.entry.clientId) uniquePartners.add(item.entry.clientId);
      if (item.reviewStatus === "resolved") {
        resolvedCount += 1;
      } else {
        openCount += 1;
      }
      if (hasAnyServiceFailed(item.entry)) {
        failedServiceCount += 1;
      }
    });

    return {
      total: filteredBookings.length,
      partners: uniquePartners.size,
      open: openCount,
      resolved: resolvedCount,
      serviceFailed: failedServiceCount,
    };
  }, [filteredBookings]);

  const formatDateSafe = (value?: string | null) => (hydrated ? formatDate(value, intlLocale) : null);

  const handleReset = () => {
    setQuery("");
    setPartnerFilter("all");
    setReviewFilter("all");
    setServiceFilter("all");
    setSortBy("newest");
    setExpandedBookingId(null);
  };

  const handleDraftChange = (bookingId: string, nextDraft: Partial<ReviewDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [bookingId]: {
        status: prev[bookingId]?.status ?? "new",
        note: prev[bookingId]?.note ?? "",
        ...nextDraft,
      },
    }));
  };

  const handleSaveReview = async (bookingId: string) => {
    if (!bookingId || savingBookingId) return;
    const draft = drafts[bookingId];
    if (!draft) return;

    setSavingBookingId(bookingId);
    setSaveFeedback((prev) => {
      const next = { ...prev };
      delete next[bookingId];
      return next;
    });

    try {
      const response = await postJson<ManageBookingResponse>(
        `/api/admin/b2b-bookings/${encodeURIComponent(bookingId)}/manage`,
        {
          status: draft.status,
          note: draft.note,
        }
      );

      const nextStatus = resolveReviewStatus(response.review?.status ?? draft.status);
      const nextNote =
        typeof response.review?.note === "string" ? response.review.note : draft.note;
      const nextUpdatedBy =
        typeof response.review?.updatedBy === "string" ? response.review.updatedBy : null;
      const nextUpdatedAt =
        typeof response.review?.updatedAt === "string" ? response.review.updatedAt : null;

      setBookings((prev) =>
        prev.map((entry) =>
          entry.id === bookingId
            ? {
                ...entry,
                review: {
                  status: nextStatus,
                  note: nextNote.trim().length > 0 ? nextNote : null,
                  updatedBy: nextUpdatedBy,
                  updatedAt: nextUpdatedAt,
                },
              }
            : entry
        )
      );

      setDrafts((prev) => ({
        ...prev,
        [bookingId]: {
          status: nextStatus,
          note: nextNote,
        },
      }));

      setSaveFeedback((prev) => ({
        ...prev,
        [bookingId]: {
          ok: true,
          message:
            typeof response.message === "string" && response.message.trim().length > 0
              ? response.message
              : t.admin.b2bBookings.actions.saveSuccess,
        },
      }));
    } catch (error) {
      setSaveFeedback((prev) => ({
        ...prev,
        [bookingId]: {
          ok: false,
          message: resolveSafeErrorFromUnknown(error, t.admin.b2bBookings.actions.saveFailed),
        },
      }));
    } finally {
      setSavingBookingId(null);
    }
  };

  return (
    <>
      <section className="admin-hero">
        <div>
          <span className="admin-eyebrow">{t.admin.title}</span>
          <h1 className="admin-title">{t.admin.b2bBookings.title}</h1>
          <p className="admin-subtitle">{t.admin.b2bBookings.subtitle}</p>
        </div>
        <div className="admin-user">
          <span>{adminUser.name ?? adminUser.email ?? t.auth.guestNameFallback}</span>
          {adminUser.email && <small>{adminUser.email}</small>}
        </div>
      </section>

      <section className="admin-stats">
        <div className="admin-stat">
          <p>{t.admin.b2bBookings.stats.total}</p>
          <strong>{stats.total}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.b2bBookings.stats.partners}</p>
          <strong>{stats.partners}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.b2bBookings.stats.open}</p>
          <strong>{stats.open}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.b2bBookings.stats.resolved}</p>
          <strong>{stats.resolved}</strong>
        </div>
        <div className="admin-stat">
          <p>{t.admin.b2bBookings.stats.serviceFailed}</p>
          <strong>{stats.serviceFailed}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>{t.admin.b2bBookings.title}</h2>
            <p>{t.admin.b2bBookings.subtitle}</p>
          </div>
          <div className="admin-controls">
            <label className="admin-control">
              <span>{t.admin.b2bBookings.filters.searchPlaceholder}</span>
              <input
                type="search"
                value={query}
                placeholder={t.admin.b2bBookings.filters.searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <label className="admin-control">
              <span>{t.admin.b2bBookings.filters.partnerLabel}</span>
              <select value={partnerFilter} onChange={(event) => setPartnerFilter(event.target.value)}>
                <option value="all">{t.admin.b2bBookings.filters.all}</option>
                {partners.map((partner) => (
                  <option key={partner} value={partner}>
                    {partner}
                  </option>
                ))}
              </select>
            </label>

            <label className="admin-control">
              <span>{t.admin.b2bBookings.filters.reviewLabel}</span>
              <select
                value={reviewFilter}
                onChange={(event) =>
                  setReviewFilter(event.target.value as B2bReviewStatus | "all")
                }
              >
                <option value="all">{t.admin.b2bBookings.filters.all}</option>
                <option value="new">{t.admin.b2bBookings.filters.reviewOptions.new}</option>
                <option value="in_progress">{t.admin.b2bBookings.filters.reviewOptions.inProgress}</option>
                <option value="needs_followup">{t.admin.b2bBookings.filters.reviewOptions.needsFollowup}</option>
                <option value="resolved">{t.admin.b2bBookings.filters.reviewOptions.resolved}</option>
              </select>
            </label>

            <label className="admin-control">
              <span>{t.admin.b2bBookings.filters.serviceLabel}</span>
              <select
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value as ServiceFilter)}
              >
                <option value="all">{t.admin.b2bBookings.filters.all}</option>
                <option value="any_failed">{t.admin.b2bBookings.filters.serviceOptions.anyFailed}</option>
                <option value="transfer_failed">{t.admin.b2bBookings.filters.serviceOptions.transferFailed}</option>
                <option value="excursions_failed">{t.admin.b2bBookings.filters.serviceOptions.excursionsFailed}</option>
                <option value="insurance_failed">{t.admin.b2bBookings.filters.serviceOptions.insuranceFailed}</option>
              </select>
            </label>

            <label className="admin-control">
              <span>{t.admin.b2bBookings.filters.sortLabel}</span>
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as "newest" | "oldest")}
              >
                <option value="newest">{t.admin.b2bBookings.filters.sortOptions.newest}</option>
                <option value="oldest">{t.admin.b2bBookings.filters.sortOptions.oldest}</option>
              </select>
            </label>

            <button type="button" className="admin-reset" onClick={handleReset}>
              {t.admin.b2bBookings.filters.reset}
            </button>
          </div>
        </div>

        {filteredBookings.length === 0 ? (
          <div className="profile-empty">
            <h3>{t.admin.b2bBookings.emptyTitle}</h3>
            <p>{t.admin.b2bBookings.emptyBody}</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t.admin.b2bBookings.columns.requestId}</th>
                  <th>{t.admin.b2bBookings.columns.partner}</th>
                  <th>{t.admin.b2bBookings.columns.bookingRef}</th>
                  <th>{t.admin.b2bBookings.columns.hotel}</th>
                  <th>{t.admin.b2bBookings.columns.services}</th>
                  <th>{t.admin.b2bBookings.columns.review}</th>
                  <th>{t.admin.b2bBookings.columns.createdAt}</th>
                  <th>{t.admin.b2bBookings.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredBookings.map((item) => {
                  const entry = item.entry;
                  const isExpanded = expandedBookingId === entry.id;
                  const isSaving = savingBookingId === entry.id;
                  const reviewDraft = drafts[entry.id] ?? { status: "new", note: "" };
                  const feedback = saveFeedback[entry.id] ?? null;
                  const createdLabel = formatDateSafe(entry.createdAt);
                  const updatedLabel = formatDateSafe(entry.review.updatedAt);

                  const bookingRef = entry.customerRefNumber ?? "—";
                  const hotelLabel = entry.hotelCode ?? "—";
                  const destinationLabel = entry.destinationCode ?? "—";
                  const reviewStatus = resolveReviewStatus(entry.review.status);

                  return (
                    <Fragment key={entry.id}>
                      <tr>
                        <td>{entry.requestId ?? "—"}</td>
                        <td>{entry.clientId ?? "—"}</td>
                        <td>{bookingRef}</td>
                        <td>
                          <div className="admin-cell-stack">
                            <span>{hotelLabel}</span>
                            <small>{destinationLabel}</small>
                          </div>
                        </td>
                        <td>
                          <div className="admin-b2b-service-list">
                            <span className={`admin-service-chip service-${item.transferStatus}`}>
                              {t.admin.b2bBookings.labels.transfer}: {t.admin.b2bBookings.serviceStatus[item.transferStatus]}
                            </span>
                            <span className={`admin-service-chip service-${item.excursionsStatus}`}>
                              {t.admin.b2bBookings.labels.excursions}: {t.admin.b2bBookings.serviceStatus[item.excursionsStatus]}
                            </span>
                            <span className={`admin-service-chip service-${item.insuranceStatus}`}>
                              {t.admin.b2bBookings.labels.insurance}: {t.admin.b2bBookings.serviceStatus[item.insuranceStatus]}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="admin-cell-stack">
                            <span className={`admin-review-chip review-${reviewStatus}`}>
                              {t.admin.b2bBookings.filters.reviewOptions[
                                reviewStatus === "in_progress"
                                  ? "inProgress"
                                  : reviewStatus === "needs_followup"
                                    ? "needsFollowup"
                                    : reviewStatus
                              ]}
                            </span>
                            {entry.review.note && <small>{truncateText(entry.review.note)}</small>}
                          </div>
                        </td>
                        <td>{createdLabel ?? "—"}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-detail-toggle"
                            onClick={() =>
                              setExpandedBookingId((current) => (current === entry.id ? null : entry.id))
                            }
                            aria-expanded={isExpanded}
                          >
                            {t.admin.actions.details}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="admin-detail-row">
                          <td colSpan={ADMIN_B2B_BOOKINGS_COLUMN_COUNT + 1}>
                            <div className="admin-detail-body">
                              <div className="admin-detail-grid">
                                <div>
                                  <span>{t.admin.b2bBookings.labels.bookingRef}</span>
                                  <strong>{bookingRef}</strong>
                                </div>
                                <div>
                                  <span>{t.profile.bookings.labels.destination}</span>
                                  <strong>{destinationLabel}</strong>
                                </div>
                                <div>
                                  <span>{t.admin.b2bBookings.labels.dates}</span>
                                  <strong>
                                    {entry.checkInDate && entry.checkOutDate
                                      ? `${entry.checkInDate} → ${entry.checkOutDate}`
                                      : "—"}
                                  </strong>
                                </div>
                                <div>
                                  <span>{t.admin.columns.createdAt}</span>
                                  <strong>{createdLabel ?? "—"}</strong>
                                </div>
                                <div>
                                  <span>{t.admin.b2bBookings.labels.updatedBy}</span>
                                  <strong>{entry.review.updatedBy ?? "—"}</strong>
                                </div>
                                <div>
                                  <span>{t.admin.b2bBookings.labels.updatedAt}</span>
                                  <strong>{updatedLabel ?? "—"}</strong>
                                </div>
                              </div>

                              <div className="admin-json-grid">
                                <div>
                                  <span>{t.admin.b2bBookings.labels.servicePayload}</span>
                                  <pre>{JSON.stringify(entry.servicesPayload, null, 2)}</pre>
                                </div>
                                <div>
                                  <span>{t.admin.b2bBookings.labels.serviceResult}</span>
                                  <pre>{JSON.stringify(entry.servicesResult, null, 2)}</pre>
                                </div>
                                <div>
                                  <span>{t.admin.b2bBookings.labels.bookingResult}</span>
                                  <pre>{JSON.stringify(entry.bookingResult, null, 2)}</pre>
                                </div>
                              </div>

                              <div className="admin-b2b-manage">
                                <div className="admin-controls">
                                  <label className="admin-control">
                                    <span>{t.admin.b2bBookings.labels.reviewStatus}</span>
                                    <select
                                      value={reviewDraft.status}
                                      onChange={(event) =>
                                        handleDraftChange(entry.id, {
                                          status: event.target.value as B2bReviewStatus,
                                        })
                                      }
                                    >
                                      <option value="new">{t.admin.b2bBookings.filters.reviewOptions.new}</option>
                                      <option value="in_progress">
                                        {t.admin.b2bBookings.filters.reviewOptions.inProgress}
                                      </option>
                                      <option value="needs_followup">
                                        {t.admin.b2bBookings.filters.reviewOptions.needsFollowup}
                                      </option>
                                      <option value="resolved">{t.admin.b2bBookings.filters.reviewOptions.resolved}</option>
                                    </select>
                                  </label>

                                  <label className="admin-control admin-control-wide">
                                    <span>{t.admin.b2bBookings.labels.note}</span>
                                    <textarea
                                      value={reviewDraft.note}
                                      placeholder={t.admin.b2bBookings.labels.note}
                                      onChange={(event) =>
                                        handleDraftChange(entry.id, { note: event.target.value })
                                      }
                                    />
                                  </label>
                                </div>

                                <div className="admin-action-row">
                                  <button
                                    type="button"
                                    className="admin-primary"
                                    onClick={() => handleSaveReview(entry.id)}
                                    disabled={isSaving}
                                  >
                                    {isSaving
                                      ? t.admin.b2bBookings.actions.saving
                                      : t.admin.b2bBookings.actions.save}
                                  </button>

                                  {feedback && (
                                    <p className={feedback.ok ? "admin-inline-success" : "admin-inline-error"}>
                                      {feedback.message}
                                    </p>
                                  )}
                                </div>
                              </div>
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
