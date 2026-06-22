export type MealPlanKey =
  | "roomOnly"
  | "breakfast"
  | "halfBoard"
  | "fullBoard"
  | "allInclusive"
  | "ultraAllInclusive";

export type MealPlanLabels = Record<MealPlanKey, string>;

export const mealPlanKeys = [
  "roomOnly",
  "breakfast",
  "halfBoard",
  "fullBoard",
  "allInclusive",
  "ultraAllInclusive",
] as const satisfies readonly MealPlanKey[];

const mealPlanAliases: Record<MealPlanKey, string[]> = {
  roomOnly: [
    "ro",
    "room only",
    "roomonly",
    "without meal",
    "without meals",
    "no meal",
    "no meals",
    "առանց սննդի",
    "без питания",
  ],
  breakfast: [
    "bb",
    "bed breakfast",
    "bed and breakfast",
    "bedbreakfast",
    "bedandbreakfast",
    "breakfast",
    "նախաճաշ",
    "завтрак",
  ],
  halfBoard: [
    "hb",
    "half board",
    "halfboard",
    "breakfast dinner",
    "breakfast and dinner",
    "lunch dinner",
    "lunch and dinner",
    "կիսապանսիոն",
    "полупансион",
  ],
  fullBoard: [
    "fb",
    "full board",
    "fullboard",
    "breakfast lunch dinner",
    "breakfast lunch and dinner",
    "լիարժեք պանսիոն",
    "полный пансион",
  ],
  allInclusive: [
    "ai",
    "all inclusive",
    "allinclusive",
    "ամեն ինչ ներառված",
    "все включено",
    "всё включено",
  ],
  ultraAllInclusive: [
    "uai",
    "ultra all inclusive",
    "ultraallinclusive",
    "ուլտրա ամեն ինչ ներառված",
    "ультра все включено",
    "ультра всё включено",
  ],
};

const normalizeMealText = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");

const compactMealText = (value: string) => normalizeMealText(value).replace(/[^\p{L}\p{N}]+/gu, "");

const hasLatinToken = (tokens: Set<string>, token: string) => tokens.has(token);

const resolveFromLatinTokens = (value: string): MealPlanKey | null => {
  const tokens = normalizeMealText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const tokenSet = new Set(tokens);
  const has = (token: string) => hasLatinToken(tokenSet, token);

  if (has("uai") || has("ultraallinclusive") || (has("ultra") && has("all") && has("inclusive"))) {
    return "ultraAllInclusive";
  }
  if (has("ai") || has("allinclusive") || (has("all") && has("inclusive"))) {
    return "allInclusive";
  }
  if (has("fb") || has("fullboard") || (has("full") && has("board"))) {
    return "fullBoard";
  }
  if (has("hb") || has("halfboard") || (has("half") && has("board"))) {
    return "halfBoard";
  }
  if (has("breakfast") && has("lunch") && has("dinner")) {
    return "fullBoard";
  }
  if ((has("breakfast") && has("dinner")) || (has("lunch") && has("dinner"))) {
    return "halfBoard";
  }
  if (
    has("bb") ||
    has("bedbreakfast") ||
    has("bedandbreakfast") ||
    (has("bed") && has("breakfast")) ||
    has("breakfast")
  ) {
    return "breakfast";
  }
  if (has("ro") || has("roomonly") || (has("room") && has("only"))) {
    return "roomOnly";
  }
  return null;
};

export const resolveMealPlanKey = (value: string | null | undefined): MealPlanKey | null => {
  if (!value) return null;
  const normalized = normalizeMealText(value);
  if (!normalized) return null;

  if (mealPlanKeys.some((key) => key === normalized)) {
    return normalized as MealPlanKey;
  }

  const compact = compactMealText(normalized);
  for (const key of mealPlanKeys) {
    if (mealPlanAliases[key].some((alias) => compactMealText(alias) === compact)) {
      return key;
    }
  }

  return resolveFromLatinTokens(normalized);
};

export const resolveMealPlanKeys = (value: string | null | undefined): MealPlanKey[] => {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split("/")
        .map((part) => resolveMealPlanKey(part))
        .filter((key): key is MealPlanKey => Boolean(key))
    )
  );
};

export const localizeMealPlan = (
  value: string | null | undefined,
  labels: MealPlanLabels,
  keys?: readonly MealPlanKey[] | null
) => {
  if (keys && keys.length > 0) {
    return keys.map((key) => labels[key]).join(" / ");
  }
  if (!value) return null;
  const parts = value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return value;
  return parts
    .map((part) => {
      const key = resolveMealPlanKey(part);
      return key ? labels[key] : part;
    })
    .join(" / ");
};
