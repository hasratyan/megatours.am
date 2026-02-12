"use client";

import { useState } from "react";
import { postJson } from "@/lib/api-helpers";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";
import { useTranslations } from "@/components/language-provider";
import type { PromoPopupConfig, PromoPopupAdminConfig } from "@/lib/promo-popup";

type AdminPromoPopupClientProps = {
  adminUser: { name?: string | null; email?: string | null };
  initialConfig: PromoPopupAdminConfig;
};

const sanitizeConfig = (config: PromoPopupAdminConfig): PromoPopupConfig => ({
  enabled: config.enabled,
  campaignKey: config.campaignKey,
  imageUrl: config.imageUrl,
  imageAlt: config.imageAlt,
  eventTicketUrl: config.eventTicketUrl,
  locationSearchUrl: config.locationSearchUrl,
  delayMs: config.delayMs,
});

export default function AdminPromoPopupClient({
  adminUser,
  initialConfig,
}: AdminPromoPopupClientProps) {
  const t = useTranslations();
  const [config, setConfig] = useState<PromoPopupConfig>(sanitizeConfig(initialConfig));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const updateField = <K extends keyof PromoPopupConfig>(key: K, value: PromoPopupConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await postJson<{ config: PromoPopupAdminConfig }>(
        "/api/admin/promo-popup",
        { config }
      );
      setConfig(sanitizeConfig(response.config));
      setSaved(true);
    } catch (err) {
      const message = resolveSafeErrorFromUnknown(err, t.admin.promoPopup.errors.saveFailed);
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
          <h1 className="admin-title">{t.admin.promoPopup.title}</h1>
          <p className="admin-subtitle">{t.admin.promoPopup.subtitle}</p>
        </div>
        <div className="admin-user">
          <span>{adminUser.name ?? adminUser.email ?? t.auth.guestNameFallback}</span>
          {adminUser.email && <small>{adminUser.email}</small>}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>{t.admin.promoPopup.panelTitle}</h2>
            <p>{t.admin.promoPopup.note}</p>
          </div>
        </div>

        {error && <p className="admin-error">{error}</p>}

        <div className="admin-service-grid">
          <label className={`admin-service-card${config.enabled ? "" : " is-disabled"}`}>
            <div>
              <strong>{t.admin.promoPopup.fields.enabled}</strong>
              <small>
                {config.enabled
                  ? t.admin.promoPopup.status.enabled
                  : t.admin.promoPopup.status.disabled}
              </small>
            </div>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={() => updateField("enabled", !config.enabled)}
              aria-checked={config.enabled}
            />
          </label>
        </div>

        <div className="admin-controls">
          <label className="admin-control">
            <span>{t.admin.promoPopup.fields.campaignKey}</span>
            <input
              type="text"
              value={config.campaignKey}
              onChange={(event) => updateField("campaignKey", event.target.value)}
              placeholder="v1"
            />
          </label>
          <label className="admin-control">
            <span>{t.admin.promoPopup.fields.imageUrl}</span>
            <input
              type="text"
              value={config.imageUrl}
              onChange={(event) => updateField("imageUrl", event.target.value)}
              placeholder="/images/promo/hero.webp"
            />
          </label>
          <label className="admin-control">
            <span>{t.admin.promoPopup.fields.imageAlt}</span>
            <input
              type="text"
              value={config.imageAlt}
              onChange={(event) => updateField("imageAlt", event.target.value)}
              placeholder={t.promoPopup.ariaLabel}
            />
          </label>
          <label className="admin-control">
            <span>{t.admin.promoPopup.fields.eventTicketUrl}</span>
            <input
              type="text"
              value={config.eventTicketUrl}
              onChange={(event) => updateField("eventTicketUrl", event.target.value)}
              placeholder="https://tickets.example.com"
            />
          </label>
          <label className="admin-control">
            <span>{t.admin.promoPopup.fields.locationSearchUrl}</span>
            <input
              type="text"
              value={config.locationSearchUrl}
              onChange={(event) => updateField("locationSearchUrl", event.target.value)}
              placeholder="/results?..."
            />
          </label>
          <label className="admin-control">
            <span>{t.admin.promoPopup.fields.delayMs}</span>
            <input
              type="number"
              min={0}
              step={100}
              value={config.delayMs}
              onChange={(event) => updateField("delayMs", Number(event.target.value) || 0)}
            />
          </label>
        </div>

        <div className="admin-featured-actions">
          <button type="button" className="admin-primary" onClick={handleSave} disabled={saving}>
            {saving ? t.admin.promoPopup.actions.saving : t.admin.promoPopup.actions.save}
          </button>
          {saved && <span className="admin-hint">{t.admin.promoPopup.saved}</span>}
        </div>
      </section>
    </>
  );
}
