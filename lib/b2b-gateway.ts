import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { AORYX_RUNTIME_ENV } from "@/lib/env";

type ParsedClientConfig = {
  id: string;
  name: string;
  tokenHash: Uint8Array;
  scopes: Set<string>;
  allowedIps: string[] | null;
  rateLimitPerMinute: number;
  aoryxEnvironment: B2bAoryxEnvironment;
};

type RateLimitState = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
};

type RateLimitBucket = {
  count: number;
  window: number;
};

type ParsedClientsCache = {
  signature: string;
  clients: ParsedClientConfig[];
};

export type B2bGatewayContext = {
  requestId: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  aoryxEnvironment: B2bAoryxEnvironment;
  rateLimit: {
    limit: number;
    remaining: number;
    resetEpochSeconds: number;
  };
};

export type B2bGatewayAuthResult =
  | { ok: true; context: B2bGatewayContext }
  | { ok: false; response: NextResponse };

export type B2bAoryxEnvironment = "live" | "test";

const ONE_MINUTE_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;
const rateLimitBuckets = new Map<string, RateLimitBucket>();
let rateLimitSweepCounter = 0;
let parsedClientsCache: ParsedClientsCache = { signature: "", clients: [] };

const trimString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parsePositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/:\d+$/, "");

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

const hashToken = (token: string) => createHash("sha256").update(token).digest();

const getEnvSignature = () =>
  [
    process.env.B2B_API_CLIENTS_JSON ?? "",
    process.env.B2B_API_TOKEN ?? "",
    process.env.B2B_API_DEFAULT_RATE_LIMIT_PER_MINUTE ?? "",
  ].join("||");

const parseScopes = (rawScopes: unknown) => {
  if (!Array.isArray(rawScopes)) return new Set<string>(["*"]);
  const scopes = rawScopes
    .map((value) => trimString(value))
    .filter((value) => value.length > 0);
  return new Set<string>(scopes.length > 0 ? scopes : ["*"]);
};

const parseAllowedIps = (rawAllowedIps: unknown): string[] | null => {
  if (!Array.isArray(rawAllowedIps)) return null;
  const ips = rawAllowedIps
    .map((value) => normalizeIp(trimString(value)))
    .filter((value) => value.length > 0);
  return ips.length > 0 ? ips : null;
};

const parseAoryxEnvironment = (rawEnvironment: unknown): B2bAoryxEnvironment => {
  if (typeof rawEnvironment !== "string") return "live";
  const normalized = rawEnvironment.trim().toLowerCase();
  return normalized === "test" ? "test" : "live";
};

const parseClientsFromJson = (
  raw: string,
  defaultRateLimitPerMinute: number
): ParsedClientConfig[] => {
  if (!raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.error("[B2B] B2B_API_CLIENTS_JSON must be an array");
      return [];
    }

    const clients: ParsedClientConfig[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const id = trimString(record.id);
      const token = trimString(record.token);
      if (!id || !token) continue;
      const active = record.active;
      if (typeof active === "boolean" && !active) continue;
      const name = trimString(record.name) || id;
      const rateLimitPerMinute = parsePositiveInt(
        record.rateLimitPerMinute,
        defaultRateLimitPerMinute
      );
      const aoryxEnvironment = parseAoryxEnvironment(
        record.aoryxEnvironment ?? record.environment ?? record.aoryxEnv
      );

      clients.push({
        id,
        name,
        tokenHash: hashToken(token),
        scopes: parseScopes(record.scopes),
        allowedIps: parseAllowedIps(record.allowedIps),
        rateLimitPerMinute,
        aoryxEnvironment,
      });
    }
    return clients;
  } catch (error) {
    console.error("[B2B] Failed to parse B2B_API_CLIENTS_JSON", error);
    return [];
  }
};

const getParsedClients = () => {
  const signature = getEnvSignature();
  if (signature === parsedClientsCache.signature) {
    return parsedClientsCache.clients;
  }

  const defaultRateLimitPerMinute = parsePositiveInt(
    process.env.B2B_API_DEFAULT_RATE_LIMIT_PER_MINUTE,
    DEFAULT_RATE_LIMIT_PER_MINUTE
  );
  const clients = parseClientsFromJson(process.env.B2B_API_CLIENTS_JSON ?? "", defaultRateLimitPerMinute);

  const singleToken = trimString(process.env.B2B_API_TOKEN);
  if (singleToken) {
    clients.push({
      id: "default",
      name: "Default client",
      tokenHash: hashToken(singleToken),
      scopes: new Set<string>(["*"]),
      allowedIps: null,
      rateLimitPerMinute: defaultRateLimitPerMinute,
      aoryxEnvironment: AORYX_RUNTIME_ENV,
    });
  }

  parsedClientsCache = { signature, clients };
  return clients;
};

const extractBearerToken = (request: NextRequest) => {
  const authorization = trimString(request.headers.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

const getRequestId = (request: NextRequest) => {
  const incoming = trimString(request.headers.get("x-request-id"));
  return incoming.length > 0 ? incoming.slice(0, 128) : randomUUID();
};

const getRequestHost = (request: NextRequest) => {
  const forwardedHost = trimString(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || trimString(request.headers.get("host"));
  return host ? normalizeHost(host.split(",")[0] ?? host) : "";
};

const getAllowedHosts = () =>
  (process.env.B2B_API_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => normalizeHost(value))
    .filter((value) => value.length > 0);

const getRequestIp = (request: NextRequest) => {
  const forwardedFor = trimString(request.headers.get("x-forwarded-for"));
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0];
    if (first) return normalizeIp(first);
  }

  const realIp = trimString(request.headers.get("x-real-ip"));
  if (realIp) return normalizeIp(realIp);

  const cloudflareIp = trimString(request.headers.get("cf-connecting-ip"));
  if (cloudflareIp) return normalizeIp(cloudflareIp);

  return "";
};

const matchesClientToken = (candidateHash: Uint8Array, clientHash: Uint8Array) =>
  candidateHash.length === clientHash.length && timingSafeEqual(candidateHash, clientHash);

const findClientByToken = (token: string, clients: ParsedClientConfig[]) => {
  const tokenHash = hashToken(token);
  for (const client of clients) {
    if (matchesClientToken(tokenHash, client.tokenHash)) {
      return client;
    }
  }
  return null;
};

const hasScope = (client: ParsedClientConfig, requiredScope: string) =>
  client.scopes.has("*") || client.scopes.has(requiredScope);

const isIpAllowed = (client: ParsedClientConfig, requestIp: string) => {
  if (!client.allowedIps || client.allowedIps.length === 0) return true;
  if (!requestIp) return false;
  return client.allowedIps.includes(requestIp);
};

const sweepRateLimitBuckets = (activeWindow: number) => {
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.window < activeWindow - 1) {
      rateLimitBuckets.delete(key);
    }
  }
};

const consumeRateLimit = (client: ParsedClientConfig): RateLimitState => {
  const window = Math.floor(Date.now() / ONE_MINUTE_MS);
  const key = `${client.id}:${window}`;
  const bucket = rateLimitBuckets.get(key) ?? { count: 0, window };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  rateLimitSweepCounter += 1;
  if (rateLimitSweepCounter % 100 === 0) {
    sweepRateLimitBuckets(window);
  }

  const remaining = Math.max(0, client.rateLimitPerMinute - bucket.count);
  return {
    allowed: bucket.count <= client.rateLimitPerMinute,
    limit: client.rateLimitPerMinute,
    remaining,
    resetEpochSeconds: (window + 1) * 60,
  };
};

const jsonError = (status: number, message: string, requestId: string, headers?: HeadersInit) => {
  const response = NextResponse.json(
    { error: message, requestId },
    {
      status,
      headers,
    }
  );
  response.headers.set("x-request-id", requestId);
  response.headers.set("cache-control", "no-store");
  return response;
};

export const withB2bGatewayHeaders = (
  response: NextResponse,
  context: B2bGatewayContext
) => {
  response.headers.set("x-request-id", context.requestId);
  response.headers.set("x-b2b-client-id", context.clientId);
  response.headers.set("x-ratelimit-limit", String(context.rateLimit.limit));
  response.headers.set("x-ratelimit-remaining", String(context.rateLimit.remaining));
  response.headers.set("x-ratelimit-reset", String(context.rateLimit.resetEpochSeconds));
  response.headers.set("x-b2b-aoryx-environment", context.aoryxEnvironment);
  response.headers.set("cache-control", "no-store");
  return response;
};

export const authenticateB2bRequest = (
  request: NextRequest,
  requiredScope: string
): B2bGatewayAuthResult => {
  const requestId = getRequestId(request);
  const allowedHosts = getAllowedHosts();
  const requestHost = getRequestHost(request);

  if (allowedHosts.length > 0 && requestHost && !allowedHosts.includes(requestHost)) {
    return {
      ok: false,
      response: jsonError(403, "Host is not allowed for B2B API access", requestId),
    };
  }

  const clients = getParsedClients();
  if (clients.length === 0) {
    return {
      ok: false,
      response: jsonError(503, "B2B API clients are not configured", requestId),
    };
  }

  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: jsonError(401, "Missing bearer token", requestId, {
        "www-authenticate": 'Bearer realm="megatours-b2b"',
      }),
    };
  }

  const client = findClientByToken(token, clients);
  if (!client) {
    return {
      ok: false,
      response: jsonError(401, "Invalid bearer token", requestId, {
        "www-authenticate": 'Bearer error="invalid_token"',
      }),
    };
  }

  if (!hasScope(client, requiredScope)) {
    return {
      ok: false,
      response: jsonError(403, "Scope is not allowed for this client", requestId),
    };
  }

  const requestIp = getRequestIp(request);
  if (!isIpAllowed(client, requestIp)) {
    return {
      ok: false,
      response: jsonError(403, "Client IP is not allowed", requestId),
    };
  }

  const rateLimit = consumeRateLimit(client);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      response: jsonError(429, "Rate limit exceeded", requestId, {
        "retry-after": String(Math.max(1, rateLimit.resetEpochSeconds - Math.floor(Date.now() / 1000))),
        "x-ratelimit-limit": String(rateLimit.limit),
        "x-ratelimit-remaining": String(rateLimit.remaining),
        "x-ratelimit-reset": String(rateLimit.resetEpochSeconds),
      }),
    };
  }

  return {
    ok: true,
    context: {
      requestId,
      clientId: client.id,
      clientName: client.name,
      scopes: Array.from(client.scopes.values()),
      aoryxEnvironment: client.aoryxEnvironment,
      rateLimit: {
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        resetEpochSeconds: rateLimit.resetEpochSeconds,
      },
    },
  };
};
