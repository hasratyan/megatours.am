"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

type DeferredCurvedLoopProps = {
  marqueeText?: string;
  speed?: number;
  className?: string;
  curveAmount?: number;
  direction?: "left" | "right";
  interactive?: boolean;
};

const CurvedLoop = dynamic(() => import("./CurvedLoop"), {
  ssr: false,
});

export default function DeferredCurvedLoop(props: DeferredCurvedLoopProps) {
  const markerRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || shouldRender) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(marker);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div ref={markerRef} style={{ minHeight: 44 }}>
      {shouldRender ? <CurvedLoop {...props} /> : null}
    </div>
  );
}
