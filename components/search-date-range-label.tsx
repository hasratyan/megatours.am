"use client";

import { use } from "react";
import { browser } from "react-dom";

export default function SearchDateRangeLabel({ startDate, endDate, placeholder }: {
  startDate?: Date;
  endDate?: Date;
  placeholder: string;
}) {
  // The surrounding Suspense renders a placeholder until the visitor's clock is available.
  use(browser());
  if (!startDate || !endDate) return placeholder;
  const format = (date: Date) => `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
  return <>{format(startDate)} <span className="material-symbols-rounded">arrow_forward</span> {format(endDate)}</>;
}
