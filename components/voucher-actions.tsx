"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type VoucherActionsProps = {
  downloadLabel: string;
  backLabel: string;
  profileHref: string;
};

export default function VoucherActions({
  downloadLabel,
  backLabel,
  profileHref,
}: VoucherActionsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams?.get("download") !== "1") return;
    const handle = window.setTimeout(() => {
      window.print();
    }, 150);
    return () => window.clearTimeout(handle);
  }, [searchParams]);

  return (
    <div className="voucher-actions">
      <button type="button" className="voucher-download" onClick={() => window.print()}>
        <span className="material-symbols-rounded" aria-hidden="true">download</span>{downloadLabel}
      </button>
      <button type="button" className="voucher-back" onClick={() => router.push(profileHref)}>
        <span className="material-symbols-rounded" aria-hidden="true">person</span>{backLabel}
      </button>
    </div>
  );
}
