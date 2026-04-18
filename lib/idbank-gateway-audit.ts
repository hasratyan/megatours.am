import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

type IdbankGatewayOperation = "register" | "getOrderStatusExtended";

type IdbankGatewayAuditEntry = {
  loggedAt: string;
  requestId: string;
  service: "idbank-vpos";
  operation: IdbankGatewayOperation;
  context?: Record<string, unknown>;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    parsedBody: Record<string, unknown> | null;
    parseError: string | null;
  };
  error?: {
    stage: "fetch" | "response_parse";
    message: string;
    stack: string | null;
  };
};

type PersistIdbankGatewayAuditLogParams = Omit<IdbankGatewayAuditEntry, "loggedAt" | "requestId" | "service">;

const IDBANK_GATEWAY_AUDIT_ROOT = path.join(process.cwd(), "tmp", "idbank-vpos-logs");

const sanitizeFileSegment = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";

const serialize = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const resolveReferenceSegment = (context?: Record<string, unknown>) => {
  const candidates = [
    context?.orderNumber,
    context?.orderId,
    context?.paymentId,
    context?.customerRefNumber,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return sanitizeFileSegment(candidate);
    }
  }

  return "unknown";
};

const parseJsonText = (text: string) => {
  if (!text.trim()) {
    return {
      parsedBody: null,
      parseError: null,
    };
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return {
      parsedBody:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null,
      parseError: null,
    };
  } catch (error) {
    return {
      parsedBody: null,
      parseError: error instanceof Error ? error.message : "Invalid JSON response",
    };
  }
};

export const persistIdbankGatewayAuditLog = async (
  params: PersistIdbankGatewayAuditLogParams
): Promise<string | null> => {
  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const reference = resolveReferenceSegment(params.context);
  const fileName = `${timestamp}_${params.operation}_${reference}_${randomUUID().slice(0, 8)}.json`;
  const directory = path.join(IDBANK_GATEWAY_AUDIT_ROOT, dateDir);
  const filePath = path.join(directory, fileName);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify(
        serialize({
          loggedAt: now.toISOString(),
          requestId: randomUUID(),
          service: "idbank-vpos",
          ...params,
        } satisfies IdbankGatewayAuditEntry),
        null,
        2
      ),
      "utf8"
    );
    return filePath;
  } catch (error) {
    console.error("[Idbank][audit] Failed to persist gateway audit log", {
      operation: params.operation,
      reference,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
};

export const attachGatewayAuditLogPath = <T extends Error>(error: T, logPath: string | null) => {
  if (logPath) {
    (error as T & { gatewayAuditLogPath?: string }).gatewayAuditLogPath = logPath;
  }
  return error as T & { gatewayAuditLogPath?: string };
};

export const readGatewayAuditLogPath = (value: unknown): string | null => {
  if (
    value &&
    typeof value === "object" &&
    "gatewayAuditLogPath" in value &&
    typeof (value as { gatewayAuditLogPath?: unknown }).gatewayAuditLogPath === "string"
  ) {
    return ((value as { gatewayAuditLogPath?: string }).gatewayAuditLogPath ?? null) || null;
  }
  return null;
};

export const postIdbankFormWithAudit = async (params: {
  operation: IdbankGatewayOperation;
  url: string;
  body: string;
  context?: Record<string, unknown>;
}) => {
  const requestHeaders = { "Content-Type": "application/x-www-form-urlencoded" };

  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: requestHeaders,
      body: params.body,
    });
  } catch (error) {
    const wrappedError =
      error instanceof Error ? error : new Error(typeof error === "string" ? error : "IDBank request failed");
    const logPath = await persistIdbankGatewayAuditLog({
      operation: params.operation,
      context: params.context,
      request: {
        url: params.url,
        method: "POST",
        headers: requestHeaders,
        body: params.body,
      },
      error: {
        stage: "fetch",
        message: wrappedError.message,
        stack: wrappedError.stack ?? null,
      },
    });
    throw attachGatewayAuditLogPath(wrappedError, logPath);
  }

  const responseText = await response.text();
  const { parsedBody, parseError } = parseJsonText(responseText);
  const logPath = await persistIdbankGatewayAuditLog({
    operation: params.operation,
    context: params.context,
    request: {
      url: params.url,
      method: "POST",
      headers: requestHeaders,
      body: params.body,
    },
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(Array.from(response.headers.entries()).sort()),
      body: responseText,
      parsedBody,
      parseError,
    },
    ...(parseError
      ? {
          error: {
            stage: "response_parse" as const,
            message: parseError,
            stack: null,
          },
        }
      : {}),
  });

  return {
    response,
    rawResponseText: responseText,
    parsedBody,
    parseError,
    logPath,
  };
};
