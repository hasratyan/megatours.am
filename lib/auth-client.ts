"use client";

import { createAuthClient } from "better-auth/react";

const configuredBaseUrl =
  (typeof process.env.NEXT_PUBLIC_BETTER_AUTH_URL === "string" &&
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL.trim()) ||
  undefined;

export const authClient = createAuthClient({
  ...(configuredBaseUrl ? { baseURL: configuredBaseUrl } : {}),
});
