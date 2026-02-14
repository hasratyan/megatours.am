"use client";

import { useState } from "react";
import { postJson } from "@/lib/api-helpers";
import { resolveSafeErrorFromUnknown } from "@/lib/error-utils";
import { useTranslations } from "@/components/language-provider";
import type { PackageBuilderService, ServiceFlags } from "@/lib/package-builder-state";
import type { CheckoutPaymentMethod, PaymentMethodFlags } from "@/lib/payment-method-flags";

type AdminServicesClientProps = {
  adminUser: { name?: string | null; email?: string | null };
  initialFlags: ServiceFlags;
  initialPaymentMethodFlags: PaymentMethodFlags;
};

const serviceOrder: PackageBuilderService[] = [
  "hotel",
  "flight",
  "transfer",
  "excursion",
  "insurance",
];

const paymentMethodOrder: CheckoutPaymentMethod[] = ["idram", "idbank_card", "ameria_card"];

export default function AdminServicesClient({
  adminUser,
  initialFlags,
  initialPaymentMethodFlags,
}: AdminServicesClientProps) {
  const t = useTranslations();
  const [flags, setFlags] = useState<ServiceFlags>(initialFlags);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodFlags>(
    initialPaymentMethodFlags
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggleFlag = (service: PackageBuilderService) => {
    setFlags((prev) => ({ ...prev, [service]: !prev[service] }));
    setSaved(false);
    setError(null);
  };

  const togglePaymentMethod = (method: CheckoutPaymentMethod) => {
    setPaymentMethods((prev) => ({ ...prev, [method]: !prev[method] }));
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await postJson<{
        flags: ServiceFlags;
        paymentMethods: PaymentMethodFlags;
      }>("/api/admin/services", {
        flags,
        paymentMethods,
      });
      setFlags(response.flags);
      setPaymentMethods(response.paymentMethods);
      setSaved(true);
    } catch (err) {
      const message = resolveSafeErrorFromUnknown(err, t.admin.services.errors.saveFailed);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const paymentMethodLabels: Record<CheckoutPaymentMethod, string> = {
    idram: t.packageBuilder.checkout.methodIdram,
    idbank_card: t.packageBuilder.checkout.methodCard,
    ameria_card: t.packageBuilder.checkout.methodCardAmeria,
  };

  return (
    <>
      <section className="admin-hero">
        <div>
          <span className="admin-eyebrow">{t.admin.title}</span>
          <h1 className="admin-title">{t.admin.services.title}</h1>
          <p className="admin-subtitle">{t.admin.services.subtitle}</p>
        </div>
        <div className="admin-user">
          <span>{adminUser.name ?? adminUser.email ?? t.auth.guestNameFallback}</span>
          {adminUser.email && <small>{adminUser.email}</small>}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-header">
          <div>
            <h2>{t.admin.services.panelTitle}</h2>
            <p>{t.admin.services.note}</p>
          </div>
        </div>

        {error && <p className="admin-error">{error}</p>}

        <div className="admin-service-grid">
          {serviceOrder.map((service) => {
            const enabled = flags[service];
            return (
              <label
                key={service}
                className={`admin-service-card${enabled ? "" : " is-disabled"}`}
              >
                <div>
                  <strong>{t.packageBuilder.services[service]}</strong>
                  <small>
                    {enabled ? t.admin.services.status.enabled : t.admin.services.status.disabled}
                  </small>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleFlag(service)}
                  aria-checked={enabled}
                />
              </label>
            );
          })}
        </div>

        <div className="admin-panel-header">
          <div>
            <h2>{t.packageBuilder.checkout.paymentTitle}</h2>
            <p>{t.packageBuilder.checkout.paymentHint}</p>
          </div>
        </div>

        <div className="admin-service-grid">
          {paymentMethodOrder.map((method) => {
            const enabled = paymentMethods[method];
            return (
              <label
                key={method}
                className={`admin-service-card${enabled ? "" : " is-disabled"}`}
              >
                <div>
                  <strong>{paymentMethodLabels[method]}</strong>
                  <small>
                    {enabled ? t.admin.services.status.enabled : t.admin.services.status.disabled}
                  </small>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => togglePaymentMethod(method)}
                  aria-checked={enabled}
                />
              </label>
            );
          })}
        </div>

        <div className="admin-featured-actions">
          <button type="button" className="admin-primary" onClick={handleSave} disabled={saving}>
            {saving ? t.admin.services.actions.saving : t.admin.services.actions.save}
          </button>
          {saved && <span className="admin-hint">{t.admin.services.saved}</span>}
        </div>
      </section>
    </>
  );
}
