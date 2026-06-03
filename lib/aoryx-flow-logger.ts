import fs from "fs";
import path from "path";

type AoryxFlowLogPayload = {
  stage: string;
  endpoint: string;
  sessionId?: string | null;
  phase?: string;
  statusCode?: number | null;
  attempt?: number;
  maxAttempts?: number;
  request?: unknown;
  response?: unknown;
  error?: unknown;
  timestamp?: string;
};

const DEFAULT_MAX_STRING_LENGTH = 1000;
const DEFAULT_MAX_ARRAY_ITEMS = 12;
const DEFAULT_MAX_DEPTH = 5;

const sanitizeFilenamePart = (value: string | null | undefined) => {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 64);
};

const fullLogsEnabled = () => process.env.AORYX_FLOW_LOG_FULL === "1";

const readPositiveInteger = (key: string, fallback: number) => {
  const raw = Number(process.env[key]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
};

const maxStringLength = () =>
  fullLogsEnabled()
    ? Number.POSITIVE_INFINITY
    : readPositiveInteger("AORYX_FLOW_LOG_MAX_STRING_LENGTH", DEFAULT_MAX_STRING_LENGTH);

const maxArrayItems = () =>
  fullLogsEnabled()
    ? Number.POSITIVE_INFINITY
    : readPositiveInteger("AORYX_FLOW_LOG_MAX_ARRAY_ITEMS", DEFAULT_MAX_ARRAY_ITEMS);

const maxDepth = () =>
  fullLogsEnabled()
    ? Number.POSITIVE_INFINITY
    : readPositiveInteger("AORYX_FLOW_LOG_MAX_DEPTH", DEFAULT_MAX_DEPTH);

const successLogsEnabled = () => process.env.AORYX_FLOW_LOG_SUCCESS === "1";

const successSampleRate = () => {
  const raw = Number(process.env.AORYX_FLOW_LOG_SAMPLE_RATE ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 1);
};

const shouldRedactKey = (key: string) =>
  /api[-_]?key|authorization|password|secret|token|email|phone|first[-_]?name|last[-_]?name|guest/i.test(key);

const sanitizeForLog = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (value == null) return value;
  if (typeof value === "string") {
    const limit = maxStringLength();
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.split("\n").slice(0, 5).join("\n") : null,
    };
  }
  if (depth >= maxDepth()) return "[truncated]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const limit = maxArrayItems();
    return {
      length: value.length,
      items: value.slice(0, limit).map((item) => sanitizeForLog(item, depth + 1, seen)),
      truncated: value.length > limit,
    };
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        shouldRedactKey(key) ? "[redacted]" : sanitizeForLog(entry, depth + 1, seen),
      ])
    );
  }
  return String(value);
};

export const logAoryxFlow = (label: string, payload: AoryxFlowLogPayload) => {
  const isErrorLog = payload.error != null;
  if (!isErrorLog && !successLogsEnabled() && Math.random() >= successSampleRate()) {
    return;
  }

  void (async () => {
    const sessionPart = sanitizeFilenamePart(payload.sessionId) || "no-session";
    const dir = path.resolve("./logs/aoryx-flow", sessionPart);
    await fs.promises.mkdir(dir, { recursive: true });

    const timestamp = payload.timestamp ?? new Date().toISOString();
    const stampSafe = timestamp.replace(/[:.]/g, "-");
    const fileLabel = sanitizeFilenamePart(label);
    const filenameParts = [fileLabel || "aoryx", stampSafe, Math.random().toString(36).slice(2, 8)]
      .filter(Boolean)
      .join("-");
    const file = path.join(dir, `${filenameParts}.json`);

    const sanitizedPayload = sanitizeForLog(payload);
    const body = {
      ...(sanitizedPayload && typeof sanitizedPayload === "object"
        ? (sanitizedPayload as Record<string, unknown>)
        : {}),
      timestamp,
    };

    await fs.promises.writeFile(file, JSON.stringify(body, null, 2), "utf-8");
  })().catch(() => {
    // Flow logging must never break booking.
  });
};
