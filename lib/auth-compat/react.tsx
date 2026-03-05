"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { authClient } from "@/lib/auth-client";
import type { AppSession } from "@/lib/auth";

type LegacySessionStatus = "loading" | "authenticated" | "unauthenticated";

type LegacyUseSessionResult = {
  data: AppSession | null;
  status: LegacySessionStatus;
  update: () => Promise<void>;
};

type SignInOptions = {
  callbackUrl?: string;
};

type SignOutOptions = {
  callbackUrl?: string;
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const toIsoString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const toAppSession = (input: unknown): AppSession | null => {
  if (!input || typeof input !== "object") return null;
  const value = input as {
    user?: {
      id?: unknown;
      legacyUserId?: unknown;
      name?: unknown;
      email?: unknown;
      image?: unknown;
    } | null;
    session?: {
      expiresAt?: unknown;
    } | null;
  };

  if (!value.user) return null;

  const userId = toTrimmedString(value.user.legacyUserId) ?? toTrimmedString(value.user.id);

  return {
    user: {
      id: userId ?? undefined,
      name: toTrimmedString(value.user.name),
      email: toTrimmedString(value.user.email),
      image: toTrimmedString(value.user.image),
    },
    expires: toIsoString(value.session?.expiresAt) ?? undefined,
  };
};

export function SessionProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useSession(): LegacyUseSessionResult {
  const { data, isPending, refetch } = authClient.useSession();

  const mappedSession = useMemo(() => toAppSession(data), [data]);
  const status: LegacySessionStatus = isPending
    ? "loading"
    : mappedSession?.user
      ? "authenticated"
      : "unauthenticated";

  return {
    data: mappedSession,
    status,
    update: async () => {
      await refetch();
    },
  };
}

export async function signIn(provider = "google", options?: SignInOptions) {
  return authClient.signIn.social({
    provider,
    callbackURL: options?.callbackUrl,
  });
}

export async function signOut(options?: SignOutOptions) {
  const result = await authClient.signOut();

  if (options?.callbackUrl && typeof window !== "undefined") {
    const hasError = Boolean(
      result &&
        typeof result === "object" &&
        "error" in result &&
        (result as { error?: unknown }).error
    );

    if (!hasError) {
      window.location.assign(options.callbackUrl);
    }
  }

  return result;
}
