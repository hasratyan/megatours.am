"use client";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import type { PackageBuilderState } from "@/lib/package-builder-state";
import type { DestinationPackageReview } from "@/lib/packages/contracts";
import { destinationPackageReviewInput } from "@/lib/packages/selection";
import { destinationCopy } from "@/lib/destinations/registry";

/** Validate the destination quote inside the same checkout form; payment dispatch is not enabled yet. */
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
  const pending = { en: "Online booking is being prepared. Contact MEGATOURS to complete your reservation.", hy: "Առցանց ամրագրումը նախապատրաստվում է։ Ամրագրումն ավարտելու համար կապվեք MEGATOURS-ի հետ։", ru: "Онлайн-бронирование готовится. Для завершения бронирования свяжитесь с MEGATOURS." }[locale];
  return <div className="checkout-section" role="status"><p>{!hotelId ? t.packageBuilder.warningSelectHotel : current?.error ?? (!current?.review ? t.packageBuilder.toggleInProgress : pending)}</p>{current?.review ? <a href="tel:+37455659965">(+374 55) 65-99-65</a> : null}</div>;
}
