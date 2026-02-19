import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";

export type SupportedTranslationLocale = "en" | "hy" | "ru";

const TRANSLATION_CACHE_COLLECTION = "text_translation_cache";
const OPENAI_TRANSLATION_MODEL =
  typeof process.env.OPENAI_TRANSLATION_MODEL === "string" &&
  process.env.OPENAI_TRANSLATION_MODEL.trim().length > 0
    ? process.env.OPENAI_TRANSLATION_MODEL.trim()
    : "gpt-4o-mini";
const OPENAI_API_KEY =
  typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 20000;
const TRANSLATION_BATCH_SIZE = 20;

type CachedTranslationDocument = {
  _id: string;
  source: string;
  targetLocale: SupportedTranslationLocale;
  translated: string;
  provider: "openai" | "passthrough";
  createdAt: Date;
  updatedAt: Date;
};

const localeNameMap: Record<SupportedTranslationLocale, string> = {
  en: "English",
  hy: "Armenian",
  ru: "Russian",
};

const normalizeSourceText = (value: string) => value.trim().replace(/\s+/g, " ");

const buildCacheId = (source: string, targetLocale: SupportedTranslationLocale) =>
  createHash("sha256").update(`${targetLocale}:${source}`).digest("hex");

const cleanupJsonString = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
};

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const hasLetterContent = (value: string) => /[\p{L}]/u.test(value);
const hasHtmlTag = (value: string) => /<\/?[a-z][^>]*>/i.test(value);
const looksLikeShortCode = (value: string) => /^[A-Z0-9_/-]{1,8}$/.test(value);

const shouldTranslateText = (value: string, targetLocale: SupportedTranslationLocale) => {
  if (targetLocale === "en") return false;
  if (value.length < 2) return false;
  if (value.length > 3000) return false;
  if (!hasLetterContent(value)) return false;
  if (hasHtmlTag(value)) return false;
  if (looksLikeShortCode(value)) return false;
  return true;
};

const resolveProviderFromHeader = (value: unknown): "openai" | "passthrough" =>
  value === "openai" ? "openai" : "passthrough";

const resolveOpenAiTranslations = (raw: unknown, sourceTexts: string[]): string[] | null => {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const cleaned = cleanupJsonString(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const candidate =
    Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed
      ? (parsed as Record<string, unknown>).translations
      : null;
  if (!Array.isArray(candidate) || candidate.length !== sourceTexts.length) {
    return null;
  }

  return sourceTexts.map((source, index) => {
    const next = candidate[index];
    if (typeof next !== "string") return source;
    const trimmed = next.trim();
    return trimmed.length > 0 ? trimmed : source;
  });
};

const translateChunkWithOpenAi = async (
  sourceTexts: string[],
  targetLocale: SupportedTranslationLocale
): Promise<{ translations: string[]; provider: "openai" | "passthrough" }> => {
  if (sourceTexts.length === 0) {
    return { translations: [], provider: "passthrough" };
  }

  if (!OPENAI_API_KEY) {
    return { translations: sourceTexts, provider: "passthrough" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_TRANSLATION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You translate hotel booking content.",
              `Target language: ${localeNameMap[targetLocale]}.`,
              "Rules:",
              "- Keep numbers, percentages, dates, currencies, and proper hotel/brand names unchanged.",
              "- Keep punctuation and formatting style.",
              "- Do not add explanations.",
              "- Return strict JSON only: {\"translations\":[...]}",
              "- The array length and order must match the input texts exactly.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({ texts: sourceTexts }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[Translation] OpenAI translation request failed", response.status, errorText);
      return { translations: sourceTexts, provider: "passthrough" };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } | null }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? null;
    const parsed = resolveOpenAiTranslations(content, sourceTexts);
    if (!parsed) {
      console.error("[Translation] OpenAI response format mismatch");
      return { translations: sourceTexts, provider: "passthrough" };
    }

    return { translations: parsed, provider: "openai" };
  } catch (error) {
    console.error("[Translation] OpenAI request error", error);
    return { translations: sourceTexts, provider: "passthrough" };
  } finally {
    clearTimeout(timeoutId);
  }
};

const readFromCache = async (
  sourceTexts: string[],
  targetLocale: SupportedTranslationLocale
): Promise<Map<string, string>> => {
  if (sourceTexts.length === 0) return new Map<string, string>();
  try {
    const db = await getDb();
    const collection = db.collection<CachedTranslationDocument>(TRANSLATION_CACHE_COLLECTION);
    const ids = sourceTexts.map((source) => buildCacheId(source, targetLocale));
    const docs = await collection.find({ _id: { $in: ids } }).toArray();
    return docs.reduce<Map<string, string>>((map, doc) => {
      // Ignore passthrough cache entries so future requests can still be translated.
      if (doc.provider !== "openai") return map;
      map.set(doc.source, doc.translated);
      return map;
    }, new Map<string, string>());
  } catch (error) {
    console.error("[Translation] Failed to read cache", error);
    return new Map<string, string>();
  }
};

const writeToCache = async (
  entries: Array<{
    source: string;
    translated: string;
    targetLocale: SupportedTranslationLocale;
    provider: "openai" | "passthrough";
  }>
) => {
  if (entries.length === 0) return;
  try {
    const db = await getDb();
    const collection = db.collection<CachedTranslationDocument>(TRANSLATION_CACHE_COLLECTION);
    const now = new Date();
    await collection.bulkWrite(
      entries.map((entry) => ({
        updateOne: {
          filter: { _id: buildCacheId(entry.source, entry.targetLocale) },
          update: {
            $set: {
              source: entry.source,
              targetLocale: entry.targetLocale,
              translated: entry.translated,
              provider: resolveProviderFromHeader(entry.provider),
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    console.error("[Translation] Failed to write cache", error);
  }
};

export const resolveTranslationLocale = (
  input: string | null | undefined,
  fallback: SupportedTranslationLocale = "en"
): SupportedTranslationLocale => {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized.startsWith("hy")) return "hy";
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("en")) return "en";
  return fallback;
};

export const translateTextBatch = async (
  texts: string[],
  targetLocaleInput: string | null | undefined
): Promise<string[]> => {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const targetLocale = resolveTranslationLocale(targetLocaleInput);
  if (targetLocale === "en") return [...texts];

  const normalizedTexts = texts.map((value) => normalizeSourceText(value));
  const uniqueSources = Array.from(new Set(normalizedTexts.filter((value) => value.length > 0)));
  if (uniqueSources.length === 0) return [...texts];

  const translationsBySource = new Map<string, string>();
  const cached = await readFromCache(uniqueSources, targetLocale);
  cached.forEach((value, source) => {
    translationsBySource.set(source, value);
  });

  const missingSources = uniqueSources.filter((source) => !translationsBySource.has(source));
  const sourcesToTranslate = missingSources.filter((source) => shouldTranslateText(source, targetLocale));

  for (const source of missingSources) {
    if (!shouldTranslateText(source, targetLocale)) {
      translationsBySource.set(source, source);
    }
  }

  const cacheWrites: Array<{
    source: string;
    translated: string;
    targetLocale: SupportedTranslationLocale;
    provider: "openai" | "passthrough";
  }> = [];

  for (const chunk of chunkArray(sourcesToTranslate, TRANSLATION_BATCH_SIZE)) {
    const { translations, provider } = await translateChunkWithOpenAi(chunk, targetLocale);
    chunk.forEach((source, index) => {
      const translated = translations[index] ?? source;
      translationsBySource.set(source, translated);
      cacheWrites.push({
        source,
        translated,
        targetLocale,
        provider,
      });
    });
  }

  // Persist only successful model translations.
  await writeToCache(cacheWrites.filter((entry) => entry.provider === "openai"));

  return texts.map((original, index) => {
    const normalized = normalizedTexts[index];
    if (!normalized) return original;
    const translated = translationsBySource.get(normalized);
    return typeof translated === "string" && translated.length > 0 ? translated : original;
  });
};
