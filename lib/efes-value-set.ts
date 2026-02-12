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

const extractToken = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const candidates = ["jwt", "token", "access_token", "accessToken", "data"];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof (payload as { error?: unknown }).error === "string"
          ? String((payload as { error?: unknown }).error)
          : `EFES auth request failed with status ${response.status}`;
      throw new Error(message);
    }
    const token = extractToken(payload);
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
