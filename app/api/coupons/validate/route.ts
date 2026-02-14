import { NextRequest, NextResponse } from "next/server";
import {
  validateCouponForCheckout,
  type CouponValidationFailureReason,
} from "@/lib/coupons";

export const runtime = "nodejs";

const ONE_MINUTE_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 15;
const RATE_LIMIT_SWEEP_EVERY = 100;
const DEFAULT_GENERIC_ERROR_MODE = true;

type RateLimitBucket = {
  count: number;
  window: number;
};

type RateLimitState = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
let rateLimitSweepCounter = 0;

const resolveString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
};

const resolveRateLimitPerMinute = () =>
  parsePositiveInt(process.env.COUPON_VALIDATE_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT_PER_MINUTE);

const isGenericErrorModeEnabled = () =>
  parseBoolean(process.env.COUPON_VALIDATE_GENERIC_ERRORS, DEFAULT_GENERIC_ERROR_MODE);

const normalizeIp = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }
  if (trimmed.startsWith("[") && trimmed.includes("]:")) {
    const end = trimmed.indexOf("]");
    if (end > 1) return trimmed.slice(1, end);
  }
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(trimmed)) {
    return trimmed.replace(/:\d+$/, "");
  }
  return trimmed;
};

const getRequestIp = (request: NextRequest) => {
  const forwardedFor = resolveString(request.headers.get("x-forwarded-for"));
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0];
    if (first) return normalizeIp(first);
  }
  const realIp = resolveString(request.headers.get("x-real-ip"));
  if (realIp) return normalizeIp(realIp);
  const cloudflareIp = resolveString(request.headers.get("cf-connecting-ip"));
  if (cloudflareIp) return normalizeIp(cloudflareIp);
  return "";
};

const buildRateLimitKey = (request: NextRequest) => {
  const ip = getRequestIp(request);
  if (ip) return `ip:${ip}`;
  const host = resolveString(request.headers.get("host")).toLowerCase();
  const userAgent = resolveString(request.headers.get("user-agent")).slice(0, 120);
  return `fallback:${host}:${userAgent}`;
};

const sweepRateLimitBuckets = (activeWindow: number) => {
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.window < activeWindow - 1) {
      rateLimitBuckets.delete(key);
    }
  }
};

const consumeRateLimit = (request: NextRequest): RateLimitState => {
  const window = Math.floor(Date.now() / ONE_MINUTE_MS);
  const limit = resolveRateLimitPerMinute();
  const key = `${buildRateLimitKey(request)}:${window}`;
  const bucket = rateLimitBuckets.get(key) ?? { count: 0, window };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  rateLimitSweepCounter += 1;
  if (rateLimitSweepCounter % RATE_LIMIT_SWEEP_EVERY === 0) {
    sweepRateLimitBuckets(window);
  }

  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining,
    resetEpochSeconds: (window + 1) * 60,
  };
};

const withRateLimitHeaders = (response: NextResponse, rateLimit: RateLimitState) => {
  response.headers.set("x-ratelimit-limit", String(rateLimit.limit));
  response.headers.set("x-ratelimit-remaining", String(rateLimit.remaining));
  response.headers.set("x-ratelimit-reset", String(rateLimit.resetEpochSeconds));
  response.headers.set("cache-control", "no-store");
  return response;
};

const resolveRetryAfterSeconds = (resetEpochSeconds: number) =>
  Math.max(1, resetEpochSeconds - Math.floor(Date.now() / 1000));

const reasonToResponse = (
  reason: CouponValidationFailureReason,
  genericErrorMode: boolean
) => {
  if (genericErrorMode) {
    return {
      status: 400,
      payload: { error: "Coupon is invalid or unavailable.", code: "invalid_coupon" },
    };
  }
  if (reason === "invalid_format" || reason === "not_found") {
    return {
      status: 400,
      payload: { error: "Coupon is invalid.", code: "invalid_coupon" },
    };
  }
  if (reason === "disabled") {
    return {
      status: 400,
      payload: { error: "Coupon is disabled.", code: "coupon_disabled" },
    };
  }
  if (reason === "scheduled") {
    return {
      status: 400,
      payload: { error: "Coupon is not active yet.", code: "coupon_not_started" },
    };
  }
  if (reason === "expired") {
    return {
      status: 400,
      payload: { error: "Coupon has expired.", code: "coupon_expired" },
    };
  }
  if (reason === "limit_reached") {
    return {
      status: 400,
      payload: { error: "Coupon usage limit has been reached.", code: "coupon_limit_reached" },
    };
  }
  return {
    status: 400,
    payload: { error: "Coupon is temporarily disabled.", code: "coupon_temporarily_disabled" },
  };
};

export async function POST(request: NextRequest) {
  const genericErrorMode = isGenericErrorModeEnabled();
  const rateLimit = consumeRateLimit(request);
  if (!rateLimit.allowed) {
    const payload = genericErrorMode
      ? { error: "Unable to validate coupon right now.", code: "coupon_validation_unavailable" }
      : { error: "Too many coupon validation attempts. Try again in a moment.", code: "coupon_rate_limited" };
    const response = NextResponse.json(payload, {
      status: 429,
      headers: {
        "retry-after": String(resolveRetryAfterSeconds(rateLimit.resetEpochSeconds)),
      },
    });
    return withRateLimitHeaders(response, rateLimit);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { code?: unknown };
    const validation = await validateCouponForCheckout(body?.code ?? null);
    if (!validation.ok) {
      const response = reasonToResponse(validation.reason, genericErrorMode);
      return withRateLimitHeaders(
        NextResponse.json(response.payload, { status: response.status }),
        rateLimit
      );
    }

    return withRateLimitHeaders(NextResponse.json({ coupon: validation.coupon }), rateLimit);
  } catch (error) {
    console.error("[CouponValidation] Failed to validate coupon", error);
    const payload = genericErrorMode
      ? { error: "Unable to validate coupon right now.", code: "coupon_validation_unavailable" }
      : { error: "Failed to validate coupon", code: "coupon_validation_failed" };
    return withRateLimitHeaders(NextResponse.json(payload, { status: 500 }), rateLimit);
  }
}
