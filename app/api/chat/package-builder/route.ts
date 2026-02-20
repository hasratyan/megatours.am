import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { defaultLocale, locales, type Locale } from "@/lib/i18n";
import {
  generatePackageAssistantReply,
  persistPackageAssistantTurn,
} from "@/lib/package-assistant";
import { resolveSafeErrorMessage } from "@/lib/error-utils";
import type {
  PackageAssistantApiMessage,
  PackageAssistantContext,
  PackageAssistantRequest,
  PackageAssistantResponse,
} from "@/types/package-assistant";

export const runtime = "nodejs";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 2000;
const STREAM_TOKEN_DELAY_MS = 14;

const parseLocale = (value: unknown): Locale => {
  if (typeof value !== "string") return defaultLocale;
  const normalized = value.trim().toLowerCase();
  return locales.includes(normalized as Locale) ? (normalized as Locale) : defaultLocale;
};

const parseSessionId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
};

const parseMessages = (value: unknown): PackageAssistantApiMessage[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    return null;
  }
  const parsed = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const role = record.role;
      const content = record.content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        return null;
      }
      const trimmed = content.trim();
      if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_CHARS) {
        return null;
      }
      return { role, content: trimmed };
    })
    .filter((entry): entry is PackageAssistantApiMessage => Boolean(entry));

  return parsed.length > 0 ? parsed : null;
};

const parseContext = (value: unknown): PackageAssistantContext | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const parseString = (input: unknown) =>
    typeof input === "string" && input.trim().length > 0 ? input.trim() : null;
  const parseNumber = (input: unknown) => {
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input === "string") {
      const parsed = Number.parseFloat(input.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return {
    destinationCode: parseString(record.destinationCode),
    destinationName: parseString(record.destinationName),
    checkInDate: parseString(record.checkInDate),
    checkOutDate: parseString(record.checkOutDate),
    roomCount: parseNumber(record.roomCount),
    adults: parseNumber(record.adults),
    children: parseNumber(record.children),
    budgetAmount: parseNumber(record.budgetAmount),
    budgetCurrency: parseString(record.budgetCurrency),
  };
};

const getUserId = async (): Promise<string | null> => {
  try {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? session?.user?.email ?? null;
  } catch (error) {
    console.error("[PackageAssistant] Failed to resolve session", error);
    return null;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const tokenizeForStream = (value: string) => {
  const tokens = value.match(/\S+\s*/g);
  if (tokens && tokens.length > 0) return tokens;
  return value.length > 0 ? [value] : [];
};

const createNdjsonStreamResponse = (input: {
  sessionId: string;
  locale: Locale;
  messages: PackageAssistantApiMessage[];
  context: PackageAssistantContext | null;
  userId: string | null;
  lastUserMessage: string | null;
}) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const push = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        push({
          type: "session",
          sessionId: input.sessionId,
        });

        const result = await generatePackageAssistantReply({
          locale: input.locale,
          messages: input.messages,
          context: input.context,
          userId: input.userId,
          onProgress: async (event) => {
            push({
              type: "progress",
              event,
            });
          },
        });

        push({ type: "message_start" });
        const tokens = tokenizeForStream(result.reply.message ?? "");
        for (let index = 0; index < tokens.length; index += 1) {
          const token = tokens[index];
          push({ type: "token", delta: token });
          if (index % 3 === 0) {
            await sleep(STREAM_TOKEN_DELAY_MS);
          }
        }

        await persistPackageAssistantTurn({
          sessionId: input.sessionId,
          locale: input.locale,
          userId: input.userId,
          userMessage: input.lastUserMessage,
          context: input.context ?? null,
          reply: result.reply,
          model: result.meta.model,
          toolCalls: result.meta.toolCalls,
          priceAudit: result.meta.priceAudit,
        });

        push({
          type: "reply",
          sessionId: input.sessionId,
          reply: result.reply,
          meta: {
            model: result.meta.model,
            toolCalls: result.meta.toolCalls,
            priceAudit: {
              status: result.meta.priceAudit.status,
              issues: result.meta.priceAudit.issues.length,
            },
          },
        });
        push({ type: "done" });
      } catch (error) {
        push({
          type: "error",
          error: resolveSafeErrorMessage(
            error instanceof Error ? error.message : null,
            "Failed to process assistant request."
          ),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as PackageAssistantRequest | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json<PackageAssistantResponse>(
        { ok: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const messages = parseMessages(body.messages);
    if (!messages) {
      return NextResponse.json<PackageAssistantResponse>(
        { ok: false, error: "messages must be a non-empty array of user/assistant messages." },
        { status: 400 }
      );
    }

    const locale = parseLocale(body.locale);
    const sessionId = parseSessionId(body.sessionId) ?? randomUUID();
    const context = parseContext(body.context);
    const streamRequested =
      parseBoolean(body.stream) ||
      parseBoolean(request.nextUrl.searchParams.get("stream")) ||
      request.headers.get("accept")?.includes("application/x-ndjson") === true;
    const userId = await getUserId();
    const lastUserMessage =
      [...messages].reverse().find((message) => message.role === "user")?.content ?? null;

    if (streamRequested) {
      return createNdjsonStreamResponse({
        sessionId,
        locale,
        messages,
        context,
        userId,
        lastUserMessage,
      });
    }

    const result = await generatePackageAssistantReply({
      locale,
      messages,
      context,
      userId,
    });

    await persistPackageAssistantTurn({
      sessionId,
      locale,
      userId,
      userMessage: lastUserMessage,
      context: context ?? null,
      reply: result.reply,
      model: result.meta.model,
      toolCalls: result.meta.toolCalls,
      priceAudit: result.meta.priceAudit,
    });

    return NextResponse.json<PackageAssistantResponse>({
      ok: true,
      sessionId,
      reply: result.reply,
    });
  } catch (error) {
    console.error("[PackageAssistant] Route error", error);
    return NextResponse.json<PackageAssistantResponse>(
      {
        ok: false,
        error: resolveSafeErrorMessage(
          error instanceof Error ? error.message : null,
          "Failed to process assistant request."
        ),
      },
      { status: 500 }
    );
  }
}
