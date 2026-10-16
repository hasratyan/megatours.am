"use client";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import type { PackageBuilderState } from "@/lib/package-builder-state";
import type { DestinationPackageReview } from "@/lib/packages/contracts";
import { destinationPackageReviewInput } from "@/lib/packages/selection";
import { destinationCopy } from "@/lib/destinations/registry";

/** Validate hotel-bound services before opening the bank payment page. */
export default function DestinationCheckoutReview({ state }: { state: PackageBuilderState }) {
  const { locale, t } = useLanguage();
  const [result, setResult] = useState<{ key: string; review?: DestinationPackageReview; error?: string } | null>(null);
  const input = destinationPackageReviewInput(state);
  const hotelId = input.hotelOfferId;
  const payload = JSON.stringify(input);
  const key = `${locale}:${payload}`;
  useEffect(() => {
    if (!hotelId) return;
    const controller = new AbortController();
    void fetch("/api/destinations/cyprus/packages/review", { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(destinationCopy.unavailable[locale]);
      const review = await response.json() as DestinationPackageReview;
      // An older agent release may still return a combined payment total.
      if (review.paymentPlan?.version !== 1 || review.paymentPlan.checkout.provider !== "megatours") throw new Error("Unsupported payment review");
      if (!controller.signal.aborted) setResult({ key, review });
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, error: destinationCopy.unavailable[locale] }); });
    return () => controller.abort();
  }, [hotelId, payload, locale, key]);
  const current = result?.key === key ? result : null;
  const pending = { en: "Pay for your hotel and selected services first. After the hotel is confirmed, you can book and pay for flights separately. Flight fares will be checked again before payment.", hy: "Նախ վճարեք հյուրանոցի և ընտրված ծառայությունների համար։ Հյուրանոցի հաստատումից հետո կարող եք առանձին ամրագրել և վճարել ավիատոմսերը։ Ավիատոմսերի արժեքը կստուգվի կրկին մինչև վճարումը։", ru: "Сначала оплатите отель и выбранные услуги. После подтверждения отеля можно отдельно забронировать и оплатить авиабилеты. Тариф будет проверен повторно перед оплатой." }[locale];
  return <div className="checkout-section" role="status"><p>{!hotelId ? t.packageBuilder.warningSelectHotel : current?.error ?? (!current?.review ? t.packageBuilder.toggleInProgress : pending)}</p></div>;
}
