"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { DEFAULT_SERVICE_FLAGS } from "@/lib/package-builder-state";
import { loadServiceFlags } from "@/lib/service-flags-client";
import { useLanguage } from "@/components/language-provider";

const labels = { en: "Open assistant", hy: "Բացել օգնականը", ru: "Открыть помощника" };
function LoadingChat() {
  const { locale } = useLanguage();
  return (
    <div className="concierge-ai">
      <button type="button" className="concierge-ai__launcher" aria-label={labels[locale]} aria-busy="true" disabled>
        <span className="material-symbols-rounded" aria-hidden="true">robot_2</span>
        <span>AI Concierge</span>
      </button>
    </div>
  );
}

const Chat = dynamic(() => import("./package-builder-ai-chat"), { ssr: false, loading: LoadingChat });

export default function DeferredAiChat({ locale }: { locale: Locale }) {
  "use memo";
  const [enabled, setEnabled] = useState(false);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    let active = true;
    loadServiceFlags()
      .then((flags) => { if (active) setEnabled(flags.aiChat !== false); })
      .catch(() => { if (active) setEnabled(DEFAULT_SERVICE_FLAGS.aiChat); });
    return () => { active = false; };
  }, []);
  if (!enabled) return null;
  if (requested) return <Chat locale={locale} initialOpen />;
  return (
    <div className="concierge-ai">
      <button type="button" className="concierge-ai__launcher" aria-label={labels[locale]} onClick={() => setRequested(true)}>
        <span className="material-symbols-rounded" aria-hidden="true">robot_2</span>
        <span>AI Concierge</span>
      </button>
    </div>
  );
}
