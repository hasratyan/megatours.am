import { getDb } from "@/lib/db";
import { unstable_cache } from "next/cache";

export type PromoPopupConfig = {
  enabled: boolean;
  campaignKey: string;
  imageUrl: string;
  imageAlt: string;
  eventTicketUrl: string;
  locationSearchUrl: string;
  delayMs: number;
};

export type PromoPopupAdminConfig = PromoPopupConfig & {
  createdAt: string | null;
  updatedAt: string | null;
};

const COLLECTION = "promo_popup";
const DOC_ID = "promo_popup";
export const PROMO_POPUP_CACHE_TAG = "promo-popup-config";

const DEFAULT_PROMO_POPUP: PromoPopupConfig = {
  enabled: false,
  campaignKey: "v1",
  imageUrl: "",
  imageAlt: "Promotion",
  eventTicketUrl: "",
  locationSearchUrl: "",
  delayMs: 0,
};

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toStringValue = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizePromoPopupConfig = (value: unknown): PromoPopupConfig => {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const delayRaw = toNumberValue(record.delayMs);
  const delayMs = delayRaw === null
    ? DEFAULT_PROMO_POPUP.delayMs
    : clampNumber(Math.round(delayRaw), 0, 600000);

  const campaignKey = toStringValue(record.campaignKey) || DEFAULT_PROMO_POPUP.campaignKey;

  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_PROMO_POPUP.enabled,
    campaignKey,
    imageUrl: toStringValue(record.imageUrl),
    imageAlt: toStringValue(record.imageAlt) || DEFAULT_PROMO_POPUP.imageAlt,
    eventTicketUrl: toStringValue(record.eventTicketUrl),
    locationSearchUrl: toStringValue(record.locationSearchUrl),
    delayMs,
  };
};

const serializeDate = (value?: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

type PromoPopupDoc = {
  _id: string;
  config?: PromoPopupConfig;
  createdAt?: Date;
  updatedAt?: Date;
};

const readPromoPopupDoc = async (): Promise<PromoPopupDoc | null> => {
  const db = await getDb();
  return db
    .collection<PromoPopupDoc>(COLLECTION)
    .findOne({ _id: DOC_ID });
};

const getPromoPopupConfigCached = unstable_cache(async (): Promise<PromoPopupConfig> => {
  const doc = await readPromoPopupDoc();
  const config = doc && typeof doc === "object" ? doc.config : null;
  return normalizePromoPopupConfig(config ?? null);
}, ["promo-popup-config"], {
  tags: [PROMO_POPUP_CACHE_TAG],
  revalidate: 60 * 60,
});

export async function getPromoPopupConfig(): Promise<PromoPopupConfig> {
  return getPromoPopupConfigCached();
}

export async function getPromoPopupAdminConfig(): Promise<PromoPopupAdminConfig> {
  const doc = await readPromoPopupDoc();
  const config = doc && typeof doc === "object" ? doc.config : null;
  return {
    ...normalizePromoPopupConfig(config ?? null),
    createdAt: serializeDate(doc?.createdAt ?? null),
    updatedAt: serializeDate(doc?.updatedAt ?? null),
  };
}

export async function savePromoPopupConfig(value: unknown): Promise<PromoPopupAdminConfig> {
  const db = await getDb();
  const normalized = normalizePromoPopupConfig(value);
  const now = new Date();
  await db
    .collection<{ _id: string; config?: PromoPopupConfig; createdAt?: Date; updatedAt?: Date }>(COLLECTION)
    .updateOne(
    { _id: DOC_ID },
    {
      $set: {
        config: normalized,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
    );
  return getPromoPopupAdminConfig();
}
