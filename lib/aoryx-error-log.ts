import { randomUUID } from "crypto";
import { appendFile, mkdir } from "fs/promises";
import path from "path";

type AoryxEndpointErrorLogInput = {
  endpoint: string;
  phase?: string;
  message?: string | null;
  code?: string | null;
  statusCode?: number | null;
  payload?: unknown;
  response?: unknown;
  error?: unknown;
  context?: Record<string, unknown>;
};

const AORYX_ERROR_LOG_PATH = path.join(process.cwd(), "logs", "aoryx-erros.log");
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 8;
const MAX_DEPTH = 4;

const shouldRedactKey = (key: string) =>
  /api[-_]?key|authorization|password|secret|token|email|phone|first[-_]?name|last[-_]?name|guest/i.test(key);

const sanitizeForLog = (value: unknown, depth = 0): unknown => {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.split("\n").slice(0, 5).join("\n") : null,
    };
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return {
      length: value.length,
      items: value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1)),
      truncated: value.length > MAX_ARRAY_ITEMS,
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        shouldRedactKey(key) ? "[redacted]" : sanitizeForLog(entry, depth + 1),
      ])
    );
  }
  return String(value);
};

const extractErrorMessage = (error: unknown): string | null => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  return null;
};

const extractErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0 ? code.trim() : null;
};

const extractStatusCode = (error: unknown): number | null => {
  if (!error || typeof error !== "object") return null;
  const statusCode = (error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status;
  return typeof statusCode === "number" && Number.isFinite(statusCode) ? statusCode : null;
};

export const logAoryxEndpointError = async (input: AoryxEndpointErrorLogInput): Promise<void> => {
  const entry = {
    loggedAt: new Date().toISOString(),
    requestId: randomUUID(),
    service: "aoryx",
    endpoint: input.endpoint,
    phase: input.phase ?? null,
    statusCode: input.statusCode ?? extractStatusCode(input.error),
    code: input.code ?? extractErrorCode(input.error),
    message: input.message ?? extractErrorMessage(input.error) ?? "Aoryx endpoint error",
    context: sanitizeForLog(input.context),
    payload: sanitizeForLog(input.payload),
    response: sanitizeForLog(input.response),
    error: sanitizeForLog(input.error),
  };

  try {
    await mkdir(path.dirname(AORYX_ERROR_LOG_PATH), { recursive: true });
    await appendFile(AORYX_ERROR_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("[Aoryx][error-log] Failed to write Aoryx error log", {
      path: AORYX_ERROR_LOG_PATH,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
