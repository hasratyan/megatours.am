import type { AoryxRoomOption } from "@/types/aoryx";
import { resolveTranslationLocale, translateTextBatch } from "@/lib/text-translation";

const HTML_TAG_REGEX = /(<[^>]+>)/g;
const HTML_TAG_ONLY_REGEX = /^<[^>]+>$/;

const trimString = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isHtmlString = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

const isHtmlTagOnly = (value: string) => HTML_TAG_ONLY_REGEX.test(value.trim());

const extractTranslatableChunks = (value: string | null | undefined): string[] => {
  if (typeof value !== "string") return [];
  if (!isHtmlString(value)) {
    const trimmed = trimString(value);
    return trimmed ? [trimmed] : [];
  }

  return value
    .split(HTML_TAG_REGEX)
    .map((part) => (isHtmlTagOnly(part) ? null : trimString(part)))
    .filter((part): part is string => Boolean(part));
};

const withPreservedPadding = (original: string, translated: string) => {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
};

const applyTranslated = (value: string | null | undefined, dictionary: Map<string, string>) => {
  if (typeof value !== "string") return value ?? null;
  if (!isHtmlString(value)) {
    const trimmed = trimString(value);
    if (!trimmed) return value;
    const translated = dictionary.get(trimmed);
    if (!translated) return value;
    return withPreservedPadding(value, translated);
  }

  const parts = value.split(HTML_TAG_REGEX);
  return parts
    .map((part) => {
      if (isHtmlTagOnly(part)) return part;
      const trimmed = trimString(part);
      if (!trimmed) return part;
      const translated = dictionary.get(trimmed);
      return translated ? withPreservedPadding(part, translated) : part;
    })
    .join("");
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
      room.cancellationPolicy,
      ...(Array.isArray(room.inclusions) ? room.inclusions : []),
    ];
    directValues.forEach((value) => {
      textBucket.push(...extractTranslatableChunks(value));
    });

    (room.policies ?? []).forEach((policy) => {
      const conditionValues = [
        policy?.textCondition,
        ...(policy?.conditions ?? []).map((condition) => condition?.text ?? null),
      ];
      conditionValues.forEach((value) => {
        textBucket.push(...extractTranslatableChunks(value));
      });
    });

    (room.remarks ?? []).forEach((remark) => {
      textBucket.push(...extractTranslatableChunks(remark?.text));
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
    rateType: room.rateType,
    cancellationPolicy: applyTranslated(room.cancellationPolicy, dictionary),
    bedTypes: room.bedTypes,
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
//