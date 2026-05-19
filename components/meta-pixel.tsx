"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

const metaPixelScriptSrc = "https://connect.facebook.net/en_US/fbevents.js";

type FbqFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  loaded?: boolean;
  push?: FbqFunction;
  queue: unknown[][];
  version?: string;
};

type MetaPixelWindow = Window & {
  __MEGATOURS_META_PIXEL_INITIALIZED__?: Record<string, boolean>;
  _fbq?: FbqFunction;
  fbq?: FbqFunction;
};

type MetaPixelProps = {
  pixelId: string;
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

export default function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    const fbq = ensureMetaPixel();

    const metaWindow = window as MetaPixelWindow;
    metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__ =
      metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__ ?? {};
    if (!metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__[pixelId]) {
      fbq("init", pixelId);
      metaWindow.__MEGATOURS_META_PIXEL_INITIALIZED__[pixelId] = true;
    }

    const search = searchParams.toString();
    const trackedPath = `${pathname}${search ? `?${search}` : ""}`;
    if (lastTrackedPathRef.current === trackedPath) return;
    lastTrackedPathRef.current = trackedPath;

    window.setTimeout(() => {
      fbq("track", "PageView", {
        page_location: window.location.href,
        page_path: `${window.location.pathname}${window.location.search}`,
        page_title: document.title,
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
