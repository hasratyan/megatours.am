"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

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

const resolvePageViewContext = (trackedPath: string): PageViewContext => {
  const pageUrl = new URL(trackedPath, window.location.origin);

  return {
    pageLocation: pageUrl.href,
    pagePath: `${pageUrl.pathname}${pageUrl.search}`,
    pageTitle: document.title,
  };
};

const sendMetaPixelPageView = (pixelId: string, pageView: PageViewContext) => {
  const eventUrl = new URL(metaPixelTrackEndpoint);
  const timestamp = Date.now().toString();

  eventUrl.searchParams.set("id", pixelId);
  eventUrl.searchParams.set("ev", "PageView");
  eventUrl.searchParams.set("dl", pageView.pageLocation);
  eventUrl.searchParams.set("rl", document.referrer);
  eventUrl.searchParams.set("if", "false");
  eventUrl.searchParams.set("ts", timestamp);
  eventUrl.searchParams.set("eid", `mt-pageview-${timestamp}`);
  eventUrl.searchParams.set("cd[page_location]", pageView.pageLocation);
  eventUrl.searchParams.set("cd[page_path]", pageView.pagePath);
  eventUrl.searchParams.set("cd[page_title]", pageView.pageTitle);

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

export default function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
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

    const search = searchParams.toString();
    const trackedPath = `${pathname}${search ? `?${search}` : ""}`;
    if (lastTrackedPathRef.current === trackedPath) return;
    lastTrackedPathRef.current = trackedPath;

    window.setTimeout(() => {
      sendMetaPixelPageView(pixelId, resolvePageViewContext(trackedPath));
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
