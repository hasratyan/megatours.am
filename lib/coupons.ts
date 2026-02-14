import { getDb } from "@/lib/db";

const COLLECTION = "checkout_coupons";
const COUPON_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export type CouponStatus = "active" | "disabled" | "scheduled" | "expired" | "paused" | "exhausted";

export type CouponValidationFailureReason =
  | "invalid_format"
  | "not_found"
  | "disabled"
  | "scheduled"
  | "expired"
  | "paused"
  | "limit_reached";

type CouponStats = {
  successfulOrders?: number | null;
  lastSuccessfulOrderAt?: Date | string | null;
};

type CouponDoc = {
  _id: string;
  code?: string;
  discountPercent?: number;
  usageLimit?: number | null;
  enabled?: boolean;
  startsAt?: Date | string | null;
  expiresAt?: Date | string | null;
  disabledUntil?: Date | string | null;
  stats?: CouponStats | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type CouponAdminRecord = {
  code: string;
  discountPercent: number;
  usageLimit: number | null;
  enabled: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  disabledUntil: string | null;
  status: CouponStatus;
  successfulOrders: number;
  lastSuccessfulOrderAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CouponCheckoutRecord = {
  code: string;
  discountPercent: number;
  expiresAt: string | null;
  status: CouponStatus;
};

export type CouponValidationResult =
  | {
      ok: true;
      coupon: CouponCheckoutRecord;
    }
  | {
      ok: false;
      reason: CouponValidationFailureReason;
    };

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const toDate = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
};

const serializeDate = (value: unknown): string | null => {
  const date = toDate(value);
  return date ? date.toISOString() : null;
};

const parseDiscountPercent = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseUsageLimit = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.trunc(value);
    return rounded > 0 ? rounded : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.trunc(parsed);
    return rounded > 0 ? rounded : null;
  }
  return null;
};

const normalizeDiscountPercent = (value: unknown): number | null => {
  const parsed = parseDiscountPercent(value);
  if (parsed === null) return null;
  if (parsed <= 0 || parsed > 100) return null;
  return roundMoney(parsed);
};

const resolveStats = (value: unknown) => {
  const record = value && typeof value === "object" ? (value as CouponStats) : null;
  const successfulOrdersRaw = record?.successfulOrders;
  const successfulOrders =
    typeof successfulOrdersRaw === "number" && Number.isFinite(successfulOrdersRaw)
      ? Math.max(0, Math.trunc(successfulOrdersRaw))
      : 0;
  return {
    successfulOrders,
    lastSuccessfulOrderAt: serializeDate(record?.lastSuccessfulOrderAt ?? null),
  };
};

const resolveCouponStatus = (doc: CouponDoc, now = new Date()): CouponStatus => {
  const enabled = typeof doc.enabled === "boolean" ? doc.enabled : true;
  if (!enabled) return "disabled";

  const startsAt = toDate(doc.startsAt ?? null);
  if (startsAt && startsAt.getTime() > now.getTime()) {
    return "scheduled";
  }

  const expiresAt = toDate(doc.expiresAt ?? null);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }

  const disabledUntil = toDate(doc.disabledUntil ?? null);
  if (disabledUntil && disabledUntil.getTime() > now.getTime()) {
    return "paused";
  }

  const stats = resolveStats(doc.stats);
  const usageLimit = parseUsageLimit(doc.usageLimit);
  if (usageLimit !== null && stats.successfulOrders >= usageLimit) {
    return "exhausted";
  }

  return "active";
};

const normalizeCodeFromDoc = (doc: CouponDoc): string => {
  const candidate = typeof doc.code === "string" ? doc.code : doc._id;
  return normalizeCouponCode(candidate);
};

const toAdminRecord = (doc: CouponDoc, now = new Date()): CouponAdminRecord => {
  const code = normalizeCodeFromDoc(doc);
  const discountPercent = normalizeDiscountPercent(doc.discountPercent) ?? 0;
  const stats = resolveStats(doc.stats);
  return {
    code,
    discountPercent,
    usageLimit: parseUsageLimit(doc.usageLimit),
    enabled: typeof doc.enabled === "boolean" ? doc.enabled : true,
    startsAt: serializeDate(doc.startsAt ?? null),
    expiresAt: serializeDate(doc.expiresAt ?? null),
    disabledUntil: serializeDate(doc.disabledUntil ?? null),
    status: resolveCouponStatus(doc, now),
    successfulOrders: stats.successfulOrders,
    lastSuccessfulOrderAt: stats.lastSuccessfulOrderAt,
    createdAt: serializeDate(doc.createdAt ?? null),
    updatedAt: serializeDate(doc.updatedAt ?? null),
  };
};

const statusToReason = (status: CouponStatus): CouponValidationFailureReason | null => {
  if (status === "disabled") return "disabled";
  if (status === "scheduled") return "scheduled";
  if (status === "expired") return "expired";
  if (status === "paused") return "paused";
  if (status === "exhausted") return "limit_reached";
  return null;
};

export const normalizeCouponCode = (value: unknown): string => {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/\s+/g, "");
};

export const isCouponCodeFormatValid = (value: string) => COUPON_CODE_PATTERN.test(value);

export const applyCouponPercentDiscount = (amount: number, discountPercent: number) => {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const safePercent = Number.isFinite(discountPercent)
    ? Math.min(100, Math.max(0, discountPercent))
    : 0;
  const discountAmount = roundMoney((safeAmount * safePercent) / 100);
  const discountedAmount = roundMoney(Math.max(0, safeAmount - discountAmount));
  return {
    discountAmount,
    discountedAmount,
  };
};

export async function getAdminCoupons(): Promise<CouponAdminRecord[]> {
  const db = await getDb();
  const docs = (await db
    .collection<CouponDoc>(COLLECTION)
    .find({})
    .sort({ updatedAt: -1, createdAt: -1, _id: 1 })
    .toArray()) as CouponDoc[];
  const now = new Date();
  return docs.map((doc) => toAdminRecord(doc, now));
}

export async function upsertCouponAdmin(value: unknown): Promise<CouponAdminRecord> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) {
    throw new Error("Invalid coupon payload.");
  }

  const code = normalizeCouponCode(record.code);
  if (!isCouponCodeFormatValid(code)) {
    throw new Error("Coupon code must be 3-32 chars (A-Z, 0-9, -, _).");
  }

  const discountPercent = normalizeDiscountPercent(record.discountPercent);
  if (discountPercent === null) {
    throw new Error("Discount percentage must be between 0.01 and 100.");
  }
  const usageLimit = parseUsageLimit(record.usageLimit);
  if (record.usageLimit != null && record.usageLimit !== "" && usageLimit === null) {
    throw new Error("Usage limit must be a positive whole number.");
  }

  const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
  const startsAt = toDate(record.startsAt ?? null);
  const expiresAt = toDate(record.expiresAt ?? null);
  const disabledUntil = toDate(record.disabledUntil ?? null);

  if (startsAt && expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
    throw new Error("Coupon deadline must be after the start date.");
  }

  const db = await getDb();
  const now = new Date();

  await db.collection<CouponDoc>(COLLECTION).updateOne(
    { _id: code },
    {
      $set: {
        code,
        discountPercent,
        usageLimit,
        enabled,
        startsAt,
        expiresAt,
        disabledUntil,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
        stats: {
          successfulOrders: 0,
          lastSuccessfulOrderAt: null,
        },
      },
    },
    { upsert: true }
  );

  const saved = (await db.collection<CouponDoc>(COLLECTION).findOne({ _id: code })) as CouponDoc | null;
  if (!saved) {
    throw new Error("Failed to save coupon.");
  }

  return toAdminRecord(saved);
}

export async function validateCouponForCheckout(codeInput: unknown): Promise<CouponValidationResult> {
  const code = normalizeCouponCode(codeInput);
  if (!isCouponCodeFormatValid(code)) {
    return { ok: false, reason: "invalid_format" };
  }

  const db = await getDb();
  const doc = (await db.collection<CouponDoc>(COLLECTION).findOne({ _id: code })) as CouponDoc | null;
  if (!doc) {
    return { ok: false, reason: "not_found" };
  }

  const now = new Date();
  const status = resolveCouponStatus(doc, now);
  const reason = statusToReason(status);
  if (reason) {
    return { ok: false, reason };
  }

  const discountPercent = normalizeDiscountPercent(doc.discountPercent);
  if (discountPercent === null) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    coupon: {
      code: normalizeCodeFromDoc(doc),
      discountPercent,
      expiresAt: serializeDate(doc.expiresAt ?? null),
      status,
    },
  };
}

export async function incrementCouponSuccessfulOrders(codeInput: unknown): Promise<boolean> {
  const code = normalizeCouponCode(codeInput);
  if (!isCouponCodeFormatValid(code)) return false;

  const db = await getDb();
  const now = new Date();
  const result = await db.collection<CouponDoc>(COLLECTION).updateOne(
    { _id: code },
    {
      $inc: {
        "stats.successfulOrders": 1,
      },
      $set: {
        "stats.lastSuccessfulOrderAt": now,
        updatedAt: now,
      },
    }
  );

  return result.matchedCount > 0;
}
