import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";

export const orderIdValid = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const nonceHash = (nonce: string) => createHash("sha256").update(nonce).digest("hex");
function key() {
  const secret = process.env.B2C_AGENT_SERVICES_TOKEN;
  if (!secret || secret.length < 32) throw new Error("Booking storage is not configured.");
  return createHmac("sha256", secret).update("destination-order-private-v1").digest();
}
export function seal(value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function unseal<T>(value: string): T {
  const data = Buffer.from(value, "base64url"), cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8")) as T;
}
export function validIdramSignature(fields: Record<string, string>, secret: string) {
  const expected = createHash("md5").update([fields.EDP_REC_ACCOUNT, fields.EDP_AMOUNT, secret, fields.EDP_BILL_NO, fields.EDP_PAYER_ACCOUNT, fields.EDP_TRANS_ID, fields.EDP_TRANS_DATE].join(":"), "utf8").digest();
  return /^[a-f0-9]{32}$/i.test(fields.EDP_CHECKSUM ?? "") && timingSafeEqual(expected, Buffer.from(fields.EDP_CHECKSUM, "hex"));
}
