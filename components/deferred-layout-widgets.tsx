"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

const PromoPopup = dynamic(() => import("@/components/promo-popup"));
const PackageBuilderAiChat = dynamic(() => import("@/components/package-builder-ai-chat"));
const PackageBuilder = dynamic(() => import("@/components/package-builder"));

type DeferredLayoutWidgetsProps = {
  locale: Locale;
};

export default function DeferredLayoutWidgets({ locale }: DeferredLayoutWidgetsProps) {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestIdle = globalThis.requestIdleCallback?.bind(globalThis);
    const cancelIdle = globalThis.cancelIdleCallback?.bind(globalThis);

    if (requestIdle && cancelIdle) {
      const idleId = requestIdle(() => {
        setShouldRender(true);
      }, { timeout: 1500 });

      return () => {
        cancelIdle(idleId);
      };
    }

    const timeoutId = globalThis.setTimeout(() => {
      setShouldRender(true);
    }, 0);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, []);

  if (!shouldRender) return null;

  return (
    <>
      <PromoPopup />
      <PackageBuilderAiChat locale={locale} />
      <PackageBuilder />
    </>
  );
}
