"use client";

import { getJson } from "@/lib/api-helpers";
import { DEFAULT_SERVICE_FLAGS, type ServiceFlags } from "@/lib/package-builder-state";

let pending: Promise<ServiceFlags> | undefined;
let cached: { flags: ServiceFlags; expiresAt: number } | undefined;

/** Share the same short-lived public configuration across layout widgets. */
export function loadServiceFlags(): Promise<ServiceFlags> {
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.flags);
  if (pending) return pending;
  pending = getJson<{ flags?: ServiceFlags }>("/api/services/availability")
    .then(({ flags }) => {
      const result = { ...DEFAULT_SERVICE_FLAGS, ...flags };
      cached = { flags: result, expiresAt: Date.now() + 30_000 };
      return result;
    })
    .finally(() => { pending = undefined; });
  return pending;
}
