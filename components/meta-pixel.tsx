"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { metaPixelId as resolvedMetaPixelId } from "@/lib/meta-pixel-config";

const metaPixelScriptSrc = "https://connect.facebook.net/en_US/fbevents.js";
const metaPixelTrackEndpoint = "https://www.facebook.com/tr/";

type FbqFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  getState?: () => { pixels?: Array<{ id?: string }> };
  loaded?: boolean;
  push?: FbqFunction;
  queue: unknown[][];
  version?: string;
};

type MetaPixelWindow = Window & {
  __MEGATOURS_META_PIXEL_BEACONS__?: HTMLImageElement[];
  __MEGATOURS_META_PIXEL_INITIALIZED__?: Record<string, boolean>;
  _fbq?: FbqFunction;
  fbq?: FbqFunction;
};

type MetaPixelProps = {
  pixelId: string;
};

type PageViewContext = {
  pageLocation: string;
  pagePath: string;
  pageTitle: string;
};

type MetaPixelCustomDataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | Record<string, unknown>>;

type MetaPixelCustomData = Record<string, MetaPixelCustomDataValue>;

type MetaPixelEventOptions = {
  customData?: MetaPixelCustomData;
  eventIdPrefix: string;
  eventName: "PageView" | "ViewContent";
  pageView?: PageViewContext;
  pixelId: string;
};

export type MetaPixelViewContentInput = {
  contentCategory?: string | null;
  contentIds: string[];
  contentName?: string | null;
  contentType: string;
  currency?: string | null;
  numAdults?: number | null;
  numChildren?: number | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  value?: number | null;
};

const getCookieValue = (name: string) => {
  const match = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return null;

  const value = match.slice(name.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const ensureMetaPixel = () => {
  const metaWindow = window as MetaPixelWindow;
  if (metaWindow.fbq) return metaWindow.fbq;

  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
      return;
    }

    fbq.queue.push(args);
  }) as FbqFunction;

  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];

  metaWindow.fbq = fbq;
  if (!metaWindow._fbq) {
    metaWindow._fbq = fbq;
  }

  if (!document.querySelector(`script[src="${metaPixelScriptSrc}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = metaPixelScriptSrc;
    const firstScript = document.getElementsByTagName("script")[0];
    firstScript.parentNode?.insertBefore(script, firstScript);
  }

  return fbq;
};

const hasInitializedPixel = (fbq: FbqFunction, pixelId: string) => {
  try {
    return fbq.getState?.().pixels?.some((pixel) => pixel.id === pixelId) ?? false;
  } catch {
    return false;
  }
};

const ensureMetaPixelInitialized = (pixelId: string) => {
  const fbq = ensureMetaPixel();
  const metaWindow = window as MetaPixelWindow;

  metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__ =
    metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__ ?? {};

  if (
    !metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__[pixelId] &&
    !hasInitializedPixel(fbq, pixelId)
  ) {
    fbq("init", pixelId);
  }

  metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__[pixelId] = true;
};

const resolvePageViewContext = (trackedPath?: string): PageViewContext => {
  const pageUrl = trackedPath
    ? new URL(trackedPath, window.location.origin)
    : new URL(window.location.href);

  return {
    pageLocation: pageUrl.href,
    pagePath: `${pageUrl.pathname}${pageUrl.search}`,
    pageTitle: document.title,
  };
};

const serializeMetaPixelValue = (value: MetaPixelCustomDataValue) => {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value.toString();
};

const sendMetaPixelEvent = ({
  customData,
  eventIdPrefix,
  eventName,
  pageView = resolvePageViewContext(),
  pixelId,
}: MetaPixelEventOptions) => {
  const eventUrl = new URL(metaPixelTrackEndpoint);
  const timestamp = Date.now().toString();
  const eventData: MetaPixelCustomData = {
    page_location: pageView.pageLocation,
    page_path: pageView.pagePath,
    page_title: pageView.pageTitle,
    ...customData,
  };

  eventUrl.searchParams.set("id", pixelId);
  eventUrl.searchParams.set("ev", eventName);
  eventUrl.searchParams.set("dl", pageView.pageLocation);
  eventUrl.searchParams.set("rl", document.referrer);
  eventUrl.searchParams.set("if", "false");
  eventUrl.searchParams.set("ts", timestamp);
  eventUrl.searchParams.set("eid", `${eventIdPrefix}-${timestamp}`);

  Object.entries(eventData).forEach(([key, value]) => {
    const serializedValue = serializeMetaPixelValue(value);
    if (serializedValue !== null && serializedValue.trim().length > 0) {
      eventUrl.searchParams.set(`cd[${key}]`, serializedValue);
    }
  });

  if (window.screen) {
    eventUrl.searchParams.set("sw", window.screen.width.toString());
    eventUrl.searchParams.set("sh", window.screen.height.toString());
  }

  const fbp = getCookieValue("_fbp");
  if (fbp) eventUrl.searchParams.set("fbp", fbp);

  const fbc = getCookieValue("_fbc");
  if (fbc) eventUrl.searchParams.set("fbc", fbc);

  const metaWindow = window as MetaPixelWindow;
  metaWindow.__MEGATOURS_META_PIXEL_BEACONS__ =
    metaWindow.__MEGATOURS_META_PIXEL_BEACONS__ ?? [];

  const beacon = new Image(1, 1);
  const cleanup = () => {
    metaWindow.__MEGATOURS_META_PIXEL_BEACONS__ =
      metaWindow.__MEGATOURS_META_PIXEL_BEACONS__?.filter((item) => item !== beacon);
  };

  beacon.onload = cleanup;
  beacon.onerror = cleanup;
  metaWindow.__MEGATOURS_META_PIXEL_BEACONS__.push(beacon);
  beacon.src = eventUrl.toString();
};

const resolveActiveMetaPixelIds = () => {
  const metaWindow = window as MetaPixelWindow;
  const initializedPixelIds = Object.entries(
    metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__ ?? {}
  )
    .filter(([, initialized]) => initialized)
    .map(([pixelId]) => pixelId);

  return initializedPixelIds.length > 0 ? initializedPixelIds : [resolvedMetaPixelId];
};

export const trackMetaPixelViewContent = ({
  checkInDate,
  checkOutDate,
  contentCategory,
  contentIds,
  contentName,
  contentType,
  currency,
  numAdults,
  numChildren,
  value,
}: MetaPixelViewContentInput) => {
  if (typeof window === "undefined" || contentIds.length === 0) return;

  const normalizedContentIds = contentIds
    .map((contentId) => contentId.trim())
    .filter(Boolean);
  if (normalizedContentIds.length === 0) return;

  const numericValue =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Number(value.toFixed(2))
      : null;
  const firstContentId = normalizedContentIds[0];
  const contents: Array<Record<string, unknown>> = [
    {
      id: firstContentId,
      quantity: 1,
      ...(numericValue !== null ? { item_price: numericValue } : {}),
    },
  ];
  const customData: MetaPixelCustomData = {
    content_category: contentCategory,
    content_ids: normalizedContentIds,
    content_name: contentName,
    content_type: contentType,
    contents,
    currency: currency?.trim().toUpperCase() || "AMD",
    num_adults: numAdults,
    num_children: numChildren,
    checkin_date: checkInDate,
    checkout_date: checkOutDate,
    value: numericValue,
  };

  resolveActiveMetaPixelIds().forEach((pixelId) => {
    ensureMetaPixelInitialized(pixelId);
    sendMetaPixelEvent({
      customData,
      eventIdPrefix: `mt-viewcontent-${firstContentId}`,
      eventName: "ViewContent",
      pixelId,
    });
  });
};

export default function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    ensureMetaPixelInitialized(pixelId);

    const search = searchParams.toString();
    const trackedPath = `${pathname}${search ? `?${search}` : ""}`;
    if (lastTrackedPathRef.current === trackedPath) return;
    lastTrackedPathRef.current = trackedPath;

    window.setTimeout(() => {
      sendMetaPixelEvent({
        eventIdPrefix: "mt-pageview",
        eventName: "PageView",
        pageView: resolvePageViewContext(trackedPath),
        pixelId,
      });
    }, 0);
  }, [pathname, pixelId, searchParams]);

  return (
    <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        height="1"
        width="1"
        style={{ display: "none" }}
        src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        alt=""
      />
    </noscript>
  );
}
