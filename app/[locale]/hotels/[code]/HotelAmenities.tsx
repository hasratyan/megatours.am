"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@/components/language-provider";

export default function HotelAmenities({ amenities }: { amenities: string[] }) {
  const t = useTranslations();
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const measure = () => {
      if (!expanded) setOverflow(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, amenities]);

  return (
    <div className="amenities-wrapper">
      <h2>{t.hotel.amenities.title}</h2>
      <div ref={elementRef} className={`amenities${expanded ? " is-expanded" : ""}`} id="hotel-amenities">
        {amenities.map((amenity, index) => <span key={`${amenity}-${index}`}>{amenity}</span>)}
      </div>
      {overflow && (
        <button type="button" className="amenities-toggle" aria-expanded={expanded}
          aria-controls="hotel-amenities" onClick={() => setExpanded((value) => !value)}>
          <span className="material-symbols-rounded">{expanded ? "expand_less" : "expand_more"}</span>
          {expanded ? t.hotel.amenities.showLess : t.hotel.amenities.showAll}
        </button>
      )}
    </div>
  );
}
