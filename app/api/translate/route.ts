import { NextRequest, NextResponse } from "next/server";
import { resolveTranslationLocale, translateTextBatch } from "@/lib/text-translation";

export const runtime = "nodejs";

const MAX_ITEMS = 100;
const MAX_TEXT_LENGTH = 12000;

const parseTexts = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  if (value.length > MAX_ITEMS) return null;
  const parsed = value.map((item) => (typeof item === "string" ? item : null));
  if (parsed.some((item) => item === null)) return null;
  if (parsed.some((item) => (item as string).length > MAX_TEXT_LENGTH)) return null;
  return parsed as string[];
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const texts = parseTexts(body?.texts);
    if (!texts) {
      return NextResponse.json(
        { error: `texts must be an array of strings (max ${MAX_ITEMS} items, ${MAX_TEXT_LENGTH} chars each)` },
        { status: 400 }
      );
    }

    const targetLocale = resolveTranslationLocale(
      typeof body?.targetLocale === "string" ? body.targetLocale : body?.locale
    );
    const translations = await translateTextBatch(texts, targetLocale);

    return NextResponse.json({
      targetLocale,
      translations,
    });
  } catch (error) {
    console.error("[API][translate] Failed to translate texts", error);
    return NextResponse.json({ error: "Failed to translate texts" }, { status: 500 });
  }
}
