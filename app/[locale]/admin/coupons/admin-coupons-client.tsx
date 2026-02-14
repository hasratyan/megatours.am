"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "@/components/language-provider";
import { postJson } from "@/lib/api-helpers";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";
import type { CouponAdminRecord, CouponStatus } from "@/lib/coupons";

type AdminCouponsClientProps = {
  adminUser: { name?: string | null; email?: string | null };
  initialCoupons: CouponAdminRecord[];
};

type CouponFormState = {
  code: string;
  discountPercent: string;
  usageLimit: string;
  enabled: boolean;
  startsAt: string;
  expiresAt: string;
  disabledUntil: string;
};

const EMPTY_FORM: CouponFormState = {
  code: "",
  discountPercent: "",
  usageLimit: "",
  enabled: true,
  startsAt: "",
  expiresAt: "",
  disabledUntil: "",
};

const statusLabels: Record<CouponStatus, string> = {
  active: "Active",
  disabled: "Disabled",
  scheduled: "Scheduled",
  expired: "Expired",
  paused: "Temporarily disabled",
  exhausted: "Limit reached",
};

const toDatetimeLocalInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toIsoDate = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const normalizeCouponCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");

const toForm = (coupon?: CouponAdminRecord | null): CouponFormState => {
  if (!coupon) return EMPTY_FORM;
  return {
    code: coupon.code,
    discountPercent: coupon.discountPercent.toString(),
    usageLimit: coupon.usageLimit != null ? coupon.usageLimit.toString() : "",
    enabled: coupon.enabled,
    startsAt: toDatetimeLocalInput(coupon.startsAt),
    expiresAt: toDatetimeLocalInput(coupon.expiresAt),
    disabledUntil: toDatetimeLocalInput(coupon.disabledUntil),
  };
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function AdminCouponsClient({
  adminUser,
  initialCoupons,
}: AdminCouponsClientProps) {
  const t = useTranslations();
  const [coupons, setCoupons] = useState(initialCoupons);
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const activeCount = useMemo(
    () => coupons.filter((coupon) => coupon.status === "active").length,
    [coupons]
  );

  const totalOrdersPlaced = useMemo(
    () => coupons.reduce((sum, coupon) => sum + coupon.successfulOrders, 0),
    [coupons]
  );

  const updateForm = <K extends keyof CouponFormState>(key: K, value: CouponFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(null);
    setError(null);
  };

  const handleEdit = (coupon: CouponAdminRecord) => {
    setSelectedCode(coupon.code);
    setForm(toForm(coupon));
    setSaved(null);
    setError(null);
  };

  const handleReset = () => {
    setSelectedCode(null);
    setForm(EMPTY_FORM);
    setSaved(null);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);

    const code = normalizeCouponCode(form.code);
    const discountPercent = Number(form.discountPercent);
    const usageLimitRaw = form.usageLimit.trim();
    const usageLimit = usageLimitRaw.length > 0 ? Number(usageLimitRaw) : null;

    try {
      const response = await postJson<{ coupon: CouponAdminRecord; coupons: CouponAdminRecord[] }>(
        "/api/admin/coupons",
        {
          coupon: {
            code,
            discountPercent,
            usageLimit,
            enabled: form.enabled,
            startsAt: toIsoDate(form.startsAt),
            expiresAt: toIsoDate(form.expiresAt),
            disabledUntil: toIsoDate(form.disabledUntil),
          },
        }
      );
      setCoupons(response.coupons);
      setSelectedCode(response.coupon.code);
      setForm(toForm(response.coupon));
      setSaved(`Coupon ${response.coupon.code} saved.`);
    } catch (err) {
      const message = resolveSafeErrorFromUnknown(err, "Failed to save coupon.");
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="admin-hero">
        <div>
          <span className="admin-eyebrow">{t.admin.title}</span>
          <h1 className="admin-title">Coupons</h1>
          <p className="admin-subtitle">
            Create and edit checkout coupon codes, deadlines, and temporary pauses.
          </p>
        </div>
        <div className="admin-user">
          <span>{adminUser.name ?? adminUser.email ?? t.auth.guestNameFallback}</span>
          {adminUser.email && <small>{adminUser.email}</small>}
        </div>
      </section>

      <section className="admin-stats">
        <div className="admin-stat">
          <p>Coupons</p>
          <strong>{coupons.length}</strong>
        </div>
        <div className="admin-stat">
          <p>Active now</p>
          <strong>{activeCount}</strong>
        </div>
        <div className="admin-stat">
          <p>Orders placed</p>
          <strong>{totalOrdersPlaced}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>{selectedCode ? `Edit ${selectedCode}` : "New coupon"}</h2>
            <p>
              Standard scheme: code, percentage, enabled state, start/deadline, temporary disable.
            </p>
          </div>
        </div>

        {error ? <p className="admin-error">{error}</p> : null}

        <div className="admin-controls">
          <label className="admin-control">
            <span>Coupon code</span>
            <input
              type="text"
              value={form.code}
              onChange={(event) => updateForm("code", event.target.value.toUpperCase())}
              placeholder="SUMMER20"
            />
          </label>
          <label className="admin-control">
            <span>Discount %</span>
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={form.discountPercent}
              onChange={(event) => updateForm("discountPercent", event.target.value)}
              placeholder="10"
            />
          </label>
          <label className="admin-control">
            <span>Usage limit (optional)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={form.usageLimit}
              onChange={(event) => updateForm("usageLimit", event.target.value)}
              placeholder="100"
            />
          </label>
          <label className="admin-control">
            <span>Start date (optional)</span>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => updateForm("startsAt", event.target.value)}
            />
          </label>
          <label className="admin-control">
            <span>Deadline (optional)</span>
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) => updateForm("expiresAt", event.target.value)}
            />
          </label>
          <label className="admin-control">
            <span>Disable until (optional)</span>
            <input
              type="datetime-local"
              value={form.disabledUntil}
              onChange={(event) => updateForm("disabledUntil", event.target.value)}
            />
          </label>
          <label className="admin-control">
            <span>Enabled</span>
            <select
              value={form.enabled ? "1" : "0"}
              onChange={(event) => updateForm("enabled", event.target.value === "1")}
            >
              <option value="1">Enabled</option>
              <option value="0">Disabled</option>
            </select>
          </label>
        </div>

        <div className="admin-featured-actions">
          <button type="button" className="admin-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save coupon"}
          </button>
          <button type="button" className="admin-secondary" onClick={handleReset} disabled={saving}>
            New coupon
          </button>
          {saved ? <span className="admin-hint">{saved}</span> : null}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>Existing coupons</h2>
            <p>Orders placed counts successful bookings completed with each code.</p>
          </div>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Status</th>
                <th>Orders placed</th>
                <th>Usage limit</th>
                <th>Deadline</th>
                <th>Disabled until</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.length === 0 ? (
                <tr>
                  <td colSpan={9} className="admin-empty-cell">
                    No coupons yet.
                  </td>
                </tr>
              ) : (
                coupons.map((coupon) => (
                  <tr key={coupon.code}>
                    <td>
                      <strong>{coupon.code}</strong>
                    </td>
                    <td>{coupon.discountPercent}%</td>
                    <td>{statusLabels[coupon.status]}</td>
                    <td>{coupon.successfulOrders}</td>
                    <td>{coupon.usageLimit != null ? coupon.usageLimit : "Unlimited"}</td>
                    <td>{formatDateTime(coupon.expiresAt)}</td>
                    <td>{formatDateTime(coupon.disabledUntil)}</td>
                    <td>{formatDateTime(coupon.updatedAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-secondary"
                        onClick={() => handleEdit(coupon)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
