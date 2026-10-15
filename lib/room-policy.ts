import type { AoryxRoomOption, AoryxRoomPolicyCondition } from "@/types/aoryx";

export const normalizeRoomPolicyDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](.*))?$/.exec(text);
  const dayFirst = /^(\d{2})[-/.](\d{2})[-/.](\d{4})(?:[T\s](.*))?$/.exec(text);
  const date = iso ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : dayFirst ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}` : null;
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const time = (iso?.[4] ?? dayFirst?.[4])?.trim();
  const normalized = time ? `${date}T${time}` : date;
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
};

const penaltyAmount = (condition: AoryxRoomPolicyCondition): number | null => {
  const values = [condition.percentage, condition.fixed, condition.nights]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const text = condition.text?.trim().replace(/[%\s,]+/g, "");
  if (text && /^\d+(?:\.\d+)?$/.test(text)) values.push(Number(text));
  return values.length ? Math.max(...values) : null;
};

/** A room-card summary only; full cancellation terms remain on the rate. */
export function summarizeRoomPolicy(
  rooms: readonly Pick<AoryxRoomOption, "policies">[],
  nonRefundable: boolean | null,
  locale: string,
  refundableUntilLabel: string,
  now = Date.now()
): string | null {
  if (nonRefundable !== false || !rooms.length) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const deadlines: string[] = [];
  for (const room of rooms) {
    const dates: string[] = [];
    for (const policy of room.policies ?? []) {
      const type = policy.type?.toLowerCase().replace(/[\s_-]/g, "");
      if (type && type !== "can" && type !== "cancel" && !type.startsWith("cancellation")) continue;
      for (const condition of policy.conditions) {
        const penalty = penaltyAmount(condition);
        if (penalty === null) continue;
        const date = normalizeRoomPolicyDate(penalty > 0 ? condition.fromDate : condition.toDate)?.slice(0, 10);
        if (penalty > 0 && !date) return null;
        if (date) dates.push(date);
      }
    }
    if (!dates.length) return null;
    const deadline = dates.sort()[0];
    if (deadline < today) return null;
    deadlines.push(deadline);
  }
  const earliest = deadlines.sort()[0];
  const date = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${earliest}T00:00:00Z`));
  return `${refundableUntilLabel} ${date}`;
}
