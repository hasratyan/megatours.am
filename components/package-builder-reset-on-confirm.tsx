"use client";

import { useEffect, useRef } from "react";
import { resetPackageBuilderState } from "@/lib/package-builder-state";

type PackageBuilderResetOnConfirmProps = {
  enabled: boolean;
};

export default function PackageBuilderResetOnConfirm({
  enabled,
}: PackageBuilderResetOnConfirmProps) {
  const hasResetRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasResetRef.current) return;
    resetPackageBuilderState();
    hasResetRef.current = true;
  }, [enabled]);

  return null;
}
