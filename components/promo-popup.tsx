"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLanguage, useTranslations } from "@/components/language-provider";
import { locales, type Locale } from "@/lib/i18n";
import type { PromoPopupConfig } from "@/lib/promo-popup";

type PromoPopupResponse = {
  config: PromoPopupConfig | null;
};

const isExternalUrl = (url: string) => /^https?:\/\//i.test(url) || url.startsWith("//");

const buildStorageKey = (campaignKey: string) => `promo_image_popup_${campaignKey}`;

const normalizeInternalUrl = (url: string, locale: Locale) => {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (isExternalUrl(trimmed) || trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("/")) {
    const segments = trimmed.split("/");
    const first = segments[1];
    if (first && locales.includes(first as Locale)) {
      return trimmed;
    }
    return `/${locale}${trimmed}`;
  }
  return `/${locale}/${trimmed}`;
};

export default function PromoPopup() {
  const t = useTranslations();
  const { locale } = useLanguage();
  const pathname = usePathname();
  const [config, setConfig] = useState<PromoPopupConfig | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const isHomePage = useMemo(() => {
    if (!pathname) return false;
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
    if (normalized === "/") return true;
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length === 1 && locales.includes(segments[0] as Locale)) return true;
    return segments.length === 2
      && locales.includes(segments[0] as Locale)
      && segments[1] === "home";
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch("/api/promo-popup", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PromoPopupResponse | null) => {
        if (!active) return;
        setConfig(data?.config ?? null);
      })
      .catch(() => {
        if (!active) return;
        setConfig(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!config?.enabled) return;
    if (!config.imageUrl) return;
    if (typeof window === "undefined") return;

    const key = buildStorageKey(config.campaignKey || "v1");
    try {
      if (window.localStorage.getItem(key) === "1") return;
      window.localStorage.setItem(key, "1");
    } catch (error) {
      // Ignore storage errors.
    }

    const delay = Math.max(0, Number.isFinite(config.delayMs) ? config.delayMs : 0);
    const timer = window.setTimeout(() => setIsOpen(true), delay);
    return () => window.clearTimeout(timer);
  }, [config]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  if (!config || !config.enabled || !config.imageUrl) return null;
  const promo = config;
  const eventUrl = promo.eventTicketUrl ? promo.eventTicketUrl.trim() : "";
  const locationUrl = promo.locationSearchUrl
    ? normalizeInternalUrl(promo.locationSearchUrl, locale)
    : "";

  const hasActions = Boolean(eventUrl || locationUrl);

  return (
    <>
      {isHomePage && !isOpen && (
        <button
          type="button"
          className="promo-popup-thumb"
          onClick={() => setIsOpen(true)}
          aria-label={t.promoPopup.ariaLabel}
        >
          <Image
            src={promo.imageUrl}
            alt={promo.imageAlt || t.promoPopup.ariaLabel}
            width={72}
            height={72}
            className="promo-popup-thumb__image"
            sizes="72px"
            unoptimized
          />
        </button>
      )}
      {isOpen && (
        <div
          className="promo-popup-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t.promoPopup.ariaLabel}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div className="promo-popup-box">
            <button
              type="button"
              className="promo-popup-close"
              onClick={() => setIsOpen(false)}
              aria-label={t.promoPopup.closeLabel}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <Image
              className="promo-popup-image"
              src={promo.imageUrl}
              alt={promo.imageAlt || t.promoPopup.ariaLabel}
              width={1200}
              height={800}
              sizes="(max-width: 720px) 90vw, 720px"
              unoptimized
            />
          </div>
          {hasActions && (
            <div className="promo-popup-actions">
              {eventUrl && (
                <a
                  className="promo-popup-btn promo-popup-btn--primary"
                  href={eventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="material-symbols-outlined">local_activity</span>
                  {t.promoPopup.eventTicketCta}
                </a>
              )}
              {locationUrl && (
                <a className="promo-popup-btn promo-popup-btn--secondary" href={locationUrl}>
                  <span className="material-symbols-outlined">search</span>
                  {t.promoPopup.locationSearchCta}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
