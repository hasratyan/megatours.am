"use client";

import { SessionProvider } from "@/lib/auth-compat/react";
import { LanguageProvider } from "@/components/language-provider";
import type { ReactNode } from "react";

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </SessionProvider>
  );
}
