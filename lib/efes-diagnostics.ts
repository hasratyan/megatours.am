import { randomUUID } from "node:crypto";

export type EfesLogContext = {
  bookingId?: string;
  sessionId?: string;
  orderId?: string;
  flow?: string;
  attemptId?: string;
  travelerIndex?: number;
};

const sensitiveKey = /name|passport|social|phone|mail|address|birthday|birthdate|birth_date|password|user|token|jwt|authorization|secret|company/i;

// Only diagnostic fields are retained; never serialize a supplier body or headers.
export function createEfesDiagnostics(input: {
  endpoint: string;
  timeoutMs: number;
  context?: EfesLogContext;
  request?: unknown;
  secrets?: string[];
}) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const secrets = new Set(input.secrets?.filter(Boolean));
  const collectSensitive = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6) return;
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKey.test(key) && (typeof child === "string" || typeof child === "number")) {
        if (String(child)) secrets.add(String(child));
      } else if (child && typeof child === "object") collectSensitive(child, depth + 1);
    }
  };
  collectSensitive(input.request);
  const clean = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
    let text = String(value);
    if (/<(?:!doctype|html|body|head)\b/i.test(text)) return "[HTML response omitted]";
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join("[redacted]");
    }
    return text
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
      .replace(/https?:\/\/\S+/gi, "[url omitted]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted]")
      .replace(/[\r\n\t]/g, " ")
      .slice(0, 1200);
  };
  let phase = "starting";
  let status: number | undefined;
  const write = (event: string, details: Record<string, unknown> = {}, failed = false) => {
    const context = input.context;
    const record = {
      timestamp: new Date().toISOString(), event, requestId,
      endpoint: input.endpoint, timeoutMs: input.timeoutMs,
      bookingId: clean(context?.bookingId), flow: clean(context?.flow),
      sessionId: clean(context?.sessionId), orderId: clean(context?.orderId),
      attemptId: context?.attemptId, travelerIndex: context?.travelerIndex,
      phase, elapsedMs: Date.now() - startedAt, status, ...details,
    };
    // Logging must never change the outcome of an insurance request.
    try {
      (failed ? console.error : console.info)(`[EFES][diagnostic] ${JSON.stringify(record)}`);
    } catch { /* Ignore logging failures. */ }
  };
  write("request_started");
  return {
    phase(value: string) { phase = value; },
    headers(response: Response) {
      status = response.status;
      phase = "response_body";
      write("response_headers", { contentType: clean(response.headers.get("content-type")) });
    },
    response(payload: unknown, bytes: number, auth = false) {
      collectSensitive(payload);
      const record = payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload as Record<string, unknown> : {};
      const supplier = auth ? undefined : Object.fromEntries(
        ["is_error", "error_code", "d_error_code", "error_msg", "d_error_msg", "error", "message"]
          .map(key => [key, clean(record[key])])
          .filter(([, value]) => value !== undefined)
      );
      phase = "response_received";
      write("response_received", {
        bytes, responseType: Array.isArray(payload) ? "array" : typeof payload,
        supplier, hasResult: auth ? undefined : Boolean(record.result),
        // Text/HTML bodies may contain credentials or traveler data; omit them.
      });
    },
    failure(error: unknown, timedOut: boolean) {
      const e = error instanceof Error ? error : undefined;
      const cause = e?.cause as { name?: unknown; code?: unknown; message?: unknown } | undefined;
      write("request_failed", {
        timedOut, errorName: clean(e?.name),
        message: input.endpoint === "/webservice/auth" && status !== undefined
          ? "EFES authentication response rejected" : clean(e?.message),
        causeName: clean(cause?.name), causeCode: clean(cause?.code), causeMessage: clean(cause?.message),
      }, true);
    },
  };
}
