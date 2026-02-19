import type { AoryxRoomOption } from "@/types/aoryx";
import { resolveTranslationLocale, translateTextBatch } from "@/lib/text-translation";

const trimString = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const withPreservedPadding = (original: string, translated: string) => {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
};

const applyTranslated = (value: string | null | undefined, dictionary: Map<string, string>) => {
  if (typeof value !== "string") return value ?? null;
  const trimmed = trimString(value);
  if (!trimmed) return value;
  const translated = dictionary.get(trimmed);
  if (!translated) return value;
  return withPreservedPadding(value, translated);
};

export const localizeAoryxRoomOptions = async (
  rooms: AoryxRoomOption[],
  localeInput: string | null | undefined
): Promise<AoryxRoomOption[]> => {
  if (!Array.isArray(rooms) || rooms.length === 0) return [];

  const targetLocale = resolveTranslationLocale(localeInput);
  if (targetLocale === "en") return rooms;

  const textBucket: string[] = [];
  rooms.forEach((room) => {
    const directValues = [
      room.name,
      room.boardType,
      room.meal,
      room.rateType,
      room.cancellationPolicy,
      ...(Array.isArray(room.bedTypes) ? room.bedTypes : []),
      ...(Array.isArray(room.inclusions) ? room.inclusions : []),
    ];
    directValues.forEach((value) => {
      const trimmed = trimString(value);
      if (trimmed) textBucket.push(trimmed);
    });

    (room.policies ?? []).forEach((policy) => {
      const conditionValues = [
        policy?.textCondition,
        ...(policy?.conditions ?? []).map((condition) => condition?.text ?? null),
      ];
      conditionValues.forEach((value) => {
        const trimmed = trimString(value);
        if (trimmed) textBucket.push(trimmed);
      });
    });

    (room.remarks ?? []).forEach((remark) => {
      const trimmed = trimString(remark?.text);
      if (trimmed) textBucket.push(trimmed);
    });
  });

  const uniqueTexts = Array.from(new Set(textBucket));
  if (uniqueTexts.length === 0) return rooms;

  const translated = await translateTextBatch(uniqueTexts, targetLocale);
  const dictionary = uniqueTexts.reduce<Map<string, string>>((map, source, index) => {
    const target = translated[index];
    map.set(source, typeof target === "string" && target.trim().length > 0 ? target : source);
    return map;
  }, new Map<string, string>());

  return rooms.map((room) => ({
    ...room,
    name: applyTranslated(room.name, dictionary),
    boardType: applyTranslated(room.boardType, dictionary),
    meal: applyTranslated(room.meal, dictionary),
    rateType: applyTranslated(room.rateType, dictionary),
    cancellationPolicy: applyTranslated(room.cancellationPolicy, dictionary),
    bedTypes: Array.isArray(room.bedTypes)
      ? room.bedTypes.map((bedType) => applyTranslated(bedType, dictionary) ?? bedType)
      : room.bedTypes,
    inclusions: Array.isArray(room.inclusions)
      ? room.inclusions.map((item) => applyTranslated(item, dictionary) ?? item)
      : room.inclusions,
    policies: Array.isArray(room.policies)
      ? room.policies.map((policy) => ({
          ...policy,
          textCondition: applyTranslated(policy.textCondition, dictionary),
          conditions: (policy.conditions ?? []).map((condition) => ({
            ...condition,
            text: applyTranslated(condition.text, dictionary),
          })),
        }))
      : room.policies,
    remarks: Array.isArray(room.remarks)
      ? room.remarks.map((remark) => ({
          ...remark,
          text: applyTranslated(remark.text, dictionary),
        }))
      : room.remarks,
  }));
};
