import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth-compat/server";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getServiceFlags } from "@/lib/service-flags";
import { consumeAssistantRateLimit } from "@/lib/package-assistant-rate-limit";
import { resolveScopedAssistantSessionId } from "@/lib/package-assistant-session";
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
const OWNER_COOKIE = "package_assistant_owner";

const parseLocale = (value: unknown): Locale => {
  if (typeof value !== "string") return defaultLocale;
  const normalized = value.trim().toLowerCase();
  return locales.includes(normalized as Locale) ? (normalized as Locale) : defaultLocale;
};

const parseSessionId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(trimmed) ? trimmed : null;
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

  const currentPackage = record.currentPackage && typeof record.currentPackage === "object"
    ? record.currentPackage as Record<string, unknown>
    : null;
  const currentHotel = currentPackage?.hotel && typeof currentPackage.hotel === "object"
    ? currentPackage.hotel as Record<string, unknown>
    : null;
  const serviceNames = ["transfer", "excursion", "insurance", "flight"] as const;
  return {
    destinationCode: parseString(record.destinationCode),
    destinationName: parseString(record.destinationName),
    checkInDate: parseString(record.checkInDate),
    checkOutDate: parseString(record.checkOutDate),
    roomCount: parseNumber(record.roomCount),
    adults: parseNumber(record.adults),
    children: parseNumber(record.children),
    childAges: Array.isArray(record.childAges)
      ? record.childAges.filter((age): age is number =>
          typeof age === "number" && Number.isInteger(age) && age >= 0 && age <= 17
        ).slice(0, 8)
      : null,
    budgetAmount: parseNumber(record.budgetAmount),
    budgetCurrency: parseString(record.budgetCurrency),
    currentPackage: currentPackage ? {
      hotel: currentHotel ? {
        hotelCode: parseString(currentHotel.hotelCode),
        hotelName: parseString(currentHotel.hotelName),
        destinationCode: parseString(currentHotel.destinationCode),
        checkInDate: parseString(currentHotel.checkInDate),
        checkOutDate: parseString(currentHotel.checkOutDate),
        roomCount: parseNumber(currentHotel.roomCount),
        guestCount: parseNumber(currentHotel.guestCount),
      } : null,
      services: Array.isArray(currentPackage.services)
        ? serviceNames.filter((name) => (currentPackage.services as unknown[]).includes(name))
        : [],
    } : null,
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

const createNdjsonStreamResponse = (input: {
  sessionId: string;
  locale: Locale;
  messages: PackageAssistantApiMessage[];
  context: PackageAssistantContext | null;
  userId: string | null;
  ownerKey: string;
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
          sessionId: input.sessionId,
          userId: input.userId,
          ownerKey: input.ownerKey,
          onTextDelta: async (delta) => {
            push({ type: "token", delta });
          },
          onProgress: async (event) => {
            push({
              type: "progress",
              event,
            });
          },
        });

        await persistPackageAssistantTurn({
          sessionId: input.sessionId,
          locale: input.locale,
          userId: input.userId,
          ownerKey: input.ownerKey,
          userMessage: input.lastUserMessage,
          context: input.context ?? null,
          reply: result.reply,
          model: result.meta.model,
          toolCalls: result.meta.toolCalls,
          priceAudit: result.meta.priceAudit,
          responseId: result.meta.responseId,
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
    const serviceFlags = await getServiceFlags();
    if (!serviceFlags.aiChat) {
      return NextResponse.json({ ok: false, error: "AI chat is disabled." }, { status: 403 });
    }
    const userId = await getUserId();
    const existingOwner = parseSessionId(request.cookies.get(OWNER_COOKIE)?.value);
    const guestOwner = existingOwner ?? randomUUID();
    const ownerKey = userId ? `user:${userId}` : `guest:${guestOwner}`;
    const rateLimit = await consumeAssistantRateLimit(ownerKey, "chat");
    if (!rateLimit.allowed) {
      return NextResponse.json({ ok: false, error: "Too many chat requests. Please try again later." }, {
        status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) },
      });
    }
    const requestedSessionId = parseSessionId(body.sessionId);
    let existingSession: { ownerKey?: string } | null = null;
    if (requestedSessionId) {
      const db = await getDb();
      existingSession = await db.collection<{ _id: string; ownerKey?: string }>("package_assistant_sessions").findOne(
        { _id: requestedSessionId }, { projection: { ownerKey: 1 } }
      );
    }
    const sessionId = resolveScopedAssistantSessionId(
      requestedSessionId, existingSession, ownerKey, Boolean(userId || existingOwner), randomUUID
    );
    const context = parseContext(body.context);
    const streamRequested =
      parseBoolean(body.stream) ||
      parseBoolean(request.nextUrl.searchParams.get("stream")) ||
      request.headers.get("accept")?.includes("application/x-ndjson") === true;
    const lastUserMessage =
      [...messages].reverse().find((message) => message.role === "user")?.content ?? null;

    if (streamRequested) {
      const response = createNdjsonStreamResponse({
        sessionId,
        locale,
        messages,
        context,
        userId,
        ownerKey,
        lastUserMessage,
      });
      if (!userId) response.cookies.set(OWNER_COOKIE, guestOwner, {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        path: "/", maxAge: 60 * 60 * 24 * 30,
      });
      return response;
    }

    const result = await generatePackageAssistantReply({
      locale,
      messages,
      context,
      sessionId,
      userId,
      ownerKey,
    });

    await persistPackageAssistantTurn({
      sessionId,
      locale,
      userId,
      ownerKey,
      userMessage: lastUserMessage,
      context: context ?? null,
      reply: result.reply,
      model: result.meta.model,
      toolCalls: result.meta.toolCalls,
      priceAudit: result.meta.priceAudit,
      responseId: result.meta.responseId,
    });

    const response = NextResponse.json<PackageAssistantResponse>({
      ok: true,
      sessionId,
      reply: result.reply,
    });
    if (!userId) response.cookies.set(OWNER_COOKIE, guestOwner, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return response;
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
