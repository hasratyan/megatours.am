import { EFES_BASE_URL, EFES_PASSWORD, EFES_TIMEOUT_MS, EFES_USER } from "@/lib/env";

const EFES_AUTH_PATH = "/webservice/auth";
const EFES_VALUE_SET_PATH = "/webservice/getValueSet";

type EfesTokenCache = {
  token: string;
  expiresAt: number | null;
};

let cachedToken: EfesTokenCache | null = null;

const normalizeBase64 = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
};

const decodeJwtExpiry = (token: string): number | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = Buffer.from(normalizeBase64(parts[1]), "base64").toString("utf8");
    const parsed = JSON.parse(payload) as { exp?: number };
    if (typeof parsed.exp === "number" && Number.isFinite(parsed.exp)) {
      return parsed.exp * 1000;
    }
  } catch {
    return null;
  }
  return null;
};

const isTokenValid = (cache: EfesTokenCache | null) => {
  if (!cache) return false;
  if (!cache.expiresAt) return true;
  return Date.now() + 60_000 < cache.expiresAt;
};

const parseEfesResponsePayload = (rawText: string): unknown => {
  const trimmed = rawText.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const normalizeTokenCandidate = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^bearer\s+/i.test(trimmed)) return trimmed;
  const withoutBearer = trimmed.replace(/^bearer\s+/i, "").trim();
  return withoutBearer.length > 0 ? withoutBearer : null;
};

const looksLikeJwt = (value: string) => {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
};

const isTokenKey = (key: string) => {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "jwt" ||
    normalized === "token" ||
    normalized === "access_token" ||
    normalized === "accesstoken" ||
    normalized === "id_token" ||
    normalized === "idtoken" ||
    normalized === "authorization" ||
    normalized.endsWith("_token") ||
    normalized.endsWith("token")
  );
};

const extractToken = (payload: unknown, depth = 0): string | null => {
  if (depth > 8) return null;
  if (typeof payload === "string") {
    const candidate = normalizeTokenCandidate(payload);
    if (!candidate) return null;
    return looksLikeJwt(candidate) || depth === 0 ? candidate : null;
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const token = extractToken(entry, depth + 1);
      if (token) return token;
    }
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") continue;
    const candidate = normalizeTokenCandidate(value);
    if (!candidate) continue;
    if (looksLikeJwt(candidate) || isTokenKey(key)) return candidate;
  }

  const nestedKeys = ["data", "result", "payload", "response", "auth", "authorization"];
  for (const key of nestedKeys) {
    if (!(key in record)) continue;
    const token = extractToken(record[key], depth + 1);
    if (token) return token;
  }

  for (const value of Object.values(record)) {
    const token = extractToken(value, depth + 1);
    if (token) return token;
  }
  return null;
};

const assertEfesCredentials = () => {
  if (!EFES_BASE_URL || !EFES_USER || !EFES_PASSWORD) {
    throw new Error("EFES credentials are not configured.");
  }
};

const fetchEfesAuthToken = async () => {
  assertEfesCredentials();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EFES_TIMEOUT_MS);
  try {
    const response = await fetch(`${EFES_BASE_URL}${EFES_AUTH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: EFES_USER, password: EFES_PASSWORD }),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const payload = parseEfesResponsePayload(rawText);
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? typeof (payload as { error?: unknown }).error === "string"
            ? String((payload as { error?: unknown }).error)
            : `EFES auth request failed with status ${response.status}`
          : typeof payload === "string" && payload.trim().length > 0
            ? payload.trim()
            : `EFES auth request failed with status ${response.status}`;
      throw new Error(message);
    }
    const headerToken = extractToken(
      response.headers.get("authorization") ??
        response.headers.get("x-access-token") ??
        response.headers.get("x-auth-token") ??
        ""
    );
    const token = extractToken(payload) ?? headerToken;
    if (!token) {
      throw new Error("EFES auth response does not include a token.");
    }
    cachedToken = {
      token,
      expiresAt: decodeJwtExpiry(token),
    };
    return token;
  } finally {
    clearTimeout(timeoutId);
  }
};

const getEfesAuthToken = async () => {
  if (isTokenValid(cachedToken)) {
    return cachedToken?.token ?? "";
  }
  return fetchEfesAuthToken();
};

const postEfesValueSet = async (payload: Record<string, unknown>, token: string) => {
  assertEfesCredentials();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EFES_TIMEOUT_MS);
  try {
    return await fetch(`${EFES_BASE_URL}${EFES_VALUE_SET_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

export const fetchEfesValueSet = async (payload: Record<string, unknown>) => {
  const dicName = typeof payload.dicName === "string" ? payload.dicName.trim() : "";
  if (!dicName) {
    throw new Error("dicName is required.");
  }
  let token = await getEfesAuthToken();
  let response = await postEfesValueSet(payload, token);
  if (response.status === 401) {
    cachedToken = null;
    token = await getEfesAuthToken();
    response = await postEfesValueSet(payload, token);
  }
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(
      rawText.trim().length > 0
        ? rawText
        : `EFES getValueSet failed with status ${response.status}`
    );
  }
  if (!rawText.trim()) return [];
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error("EFES getValueSet returned invalid JSON.");
  }
};
