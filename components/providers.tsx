"use client";

import { SessionProvider } from "@/lib/auth-compat/react";
import type { ReactNode } from "react";
import { CurrencyProvider } from "@/components/currency-provider";

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <CurrencyProvider>{children}</CurrencyProvider>
    </SessionProvider>
  );
}
