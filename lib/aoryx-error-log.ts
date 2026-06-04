import { randomUUID } from "crypto";
import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { sendOperationalEmail } from "@/lib/email";

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
const AORYX_ERROR_EMAIL_TO = "contracting8@aoryx.ae";
const AORYX_ERROR_EMAIL_FROM = "MEGATOURS | Support <support@megatours.am>";
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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const shouldSendAoryxErrorEmail = () => {
  const configured = process.env.AORYX_ERROR_EMAIL_ENABLED?.trim().toLowerCase();
  if (configured === "0" || configured === "false") return false;
  if (configured === "1" || configured === "true") return true;
  return process.env.NODE_ENV === "production";
};

const sendAoryxErrorEmail = (entry: {
  loggedAt: string;
  requestId: string;
  endpoint: string;
  phase: string | null;
  statusCode: number | null;
  code: string | null;
  message: string;
  context: unknown;
  payload: unknown;
  response: unknown;
  error: unknown;
}) => {
  if (!shouldSendAoryxErrorEmail()) return;
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_SUPPORT_USER || !process.env.SMTP_SUPPORT_PASS) {
    console.error("[Aoryx][error-email] Missing support SMTP configuration; cannot send Aoryx error email");
    return;
  }

  const details = JSON.stringify(
    {
      requestId: entry.requestId,
      loggedAt: entry.loggedAt,
      endpoint: entry.endpoint,
      phase: entry.phase,
      statusCode: entry.statusCode,
      code: entry.code,
      message: entry.message,
      context: entry.context,
      payload: entry.payload,
      response: entry.response,
      error: entry.error,
    },
    null,
    2
  );

  void sendOperationalEmail({
    to: AORYX_ERROR_EMAIL_TO,
    from: AORYX_ERROR_EMAIL_FROM,
    subject: `[Megatours] Aoryx API error: ${entry.endpoint}`,
    html: `
      <p>Hello Aoryx team,</p>
      <p>Megatours received an Aoryx API error at the moment below. Please investigate this request/response.</p>
      <p><strong>Endpoint:</strong> ${escapeHtml(entry.endpoint)}</p>
      <p><strong>Phase:</strong> ${escapeHtml(entry.phase ?? "unknown")}</p>
      <p><strong>Status:</strong> ${escapeHtml(entry.statusCode === null ? "n/a" : String(entry.statusCode))}</p>
      <p><strong>Code:</strong> ${escapeHtml(entry.code ?? "n/a")}</p>
      <p><strong>Message:</strong> ${escapeHtml(entry.message)}</p>
      <p><strong>Timestamp:</strong> ${escapeHtml(entry.loggedAt)}</p>
      <pre style="white-space: pre-wrap; word-break: break-word; background: #f6f7f9; padding: 12px; border-radius: 8px;">${escapeHtml(details)}</pre>
    `,
    text: details,
    useSupportEmail: true,
  }).catch((error) => {
    console.error("[Aoryx][error-email] Failed to send Aoryx error email", error);
  });
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

  sendAoryxErrorEmail(entry);
};
