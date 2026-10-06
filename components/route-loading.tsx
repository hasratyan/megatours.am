"use client";

import Loader from "@/components/loader";
import { useTranslations } from "@/components/language-provider";
import { ViewTransition } from "react";

type RouteLoadingProps = {
  className?: string;
};

export default function RouteLoading({ className }: RouteLoadingProps) {
  const t = useTranslations();

  return (
    <ViewTransition default="none" exit="route-loading">
    <main className={["route-loading-shell", className].filter(Boolean).join(" ")}>
      <Loader text={t.common.loading} />
    </main>
    </ViewTransition>
  );
}
