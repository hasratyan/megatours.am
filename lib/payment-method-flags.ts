import { getDb } from "@/lib/db";

export type CheckoutPaymentMethod = "idram" | "idbank_card" | "ameria_card";

export type PaymentMethodFlags = Record<CheckoutPaymentMethod, boolean>;

export const DEFAULT_PAYMENT_METHOD_FLAGS: PaymentMethodFlags = {
  idram: true,
  idbank_card: true,
  ameria_card: true,
};

const COLLECTION = "checkout_payment_method_flags";
const DOC_ID = "checkout_payment_method_flags";

const paymentMethodKeys = Object.keys(DEFAULT_PAYMENT_METHOD_FLAGS) as CheckoutPaymentMethod[];

const normalizePaymentMethodFlags = (
  value: unknown,
  base: PaymentMethodFlags = DEFAULT_PAYMENT_METHOD_FLAGS
): PaymentMethodFlags => {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const next: PaymentMethodFlags = { ...base };
  paymentMethodKeys.forEach((key) => {
    if (typeof record[key] === "boolean") {
      next[key] = record[key] as boolean;
    }
  });
  return next;
};

export const extractPaymentMethodFlagUpdates = (
  value: unknown
): Partial<PaymentMethodFlags> => {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const updates: Partial<PaymentMethodFlags> = {};
  paymentMethodKeys.forEach((key) => {
    if (typeof record[key] === "boolean") {
      updates[key] = record[key] as boolean;
    }
  });
  return updates;
};

export async function getPaymentMethodFlags(): Promise<PaymentMethodFlags> {
  const db = await getDb();
  const doc = await db
    .collection<{ _id: string; flags?: PaymentMethodFlags }>(COLLECTION)
    .findOne({ _id: DOC_ID });
  const flags = doc && typeof doc === "object" ? (doc as Record<string, unknown>).flags : null;
  return normalizePaymentMethodFlags(flags ?? null);
}

export async function savePaymentMethodFlags(
  flags: PaymentMethodFlags
): Promise<PaymentMethodFlags> {
  const db = await getDb();
  const normalized = normalizePaymentMethodFlags(flags);
  const now = new Date();
  await db.collection<{ _id: string; flags?: PaymentMethodFlags }>(COLLECTION).updateOne(
    { _id: DOC_ID },
    {
      $set: {
        flags: normalized,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return normalized;
}
