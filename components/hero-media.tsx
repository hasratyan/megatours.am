"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

const shouldEnableHeroVideo = () => {
  if (typeof window === "undefined") return false;
  if (window.innerWidth < 768) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.matchMedia("(prefers-reduced-data: reduce)").matches) return false;

  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return false;

  return true;
};

export default function HeroMedia() {
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  useEffect(() => {
    if (!shouldEnableHeroVideo()) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;

    const loadVideo = () => setShouldLoadVideo(true);

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(loadVideo, { timeout: 1800 });
    } else {
      timeoutId = globalThis.setTimeout(loadVideo, 900);
    }

    return () => {
      if (typeof idleId === "number" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (typeof timeoutId === "number") {
        globalThis.clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <div className="videoWrap" aria-hidden="true">
      <Image
        src="/images/burj-khalifa.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className="videoWrap__image"
      />
      {shouldLoadVideo ? (
        <video
          className="videoWrap__video"
          src="/videos/uae.mp4"
          preload="none"
          autoPlay
          muted
          loop
          playsInline
        />
      ) : null}
    </div>
  );
}
