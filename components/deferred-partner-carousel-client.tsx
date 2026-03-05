"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

type DeferredPartnerCarouselClientProps = {
  loop?: boolean;
  autoplayDelay?: number;
};

const PartnerCarouselClient = dynamic(() => import("./partner-carousel-client"), {
  ssr: false,
});

export default function DeferredPartnerCarouselClient({
  loop,
  autoplayDelay,
}: DeferredPartnerCarouselClientProps) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [shouldHydrate, setShouldHydrate] = useState(false);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || shouldHydrate) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setShouldHydrate(true);
        observer.disconnect();
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, [shouldHydrate]);

  if (shouldHydrate) {
    return <PartnerCarouselClient loop={loop} autoplayDelay={autoplayDelay} />;
  }

  return (
    <span
      ref={markerRef}
      aria-hidden="true"
      style={{ display: "block", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
    />
  );
}
