const mealFamilies: Record<string, string> = {
  RO: "RO",
  BB: "BB",
  HB: "HB", HBP: "HB", HBD: "HB", HBPR: "HB",
  FB: "FB", FBP: "FB", FBD: "FB", FBPR: "FB",
  AI: "AI", AIP: "AI", AID: "AI", AIL: "AI", SAI: "AI", UAI: "AI", PAI: "AI",
};

const mealNames: Record<string, string> = {
  "ROOM ONLY": "RO",
  "BED & BREAKFAST": "BB",
  "BED AND BREAKFAST": "BB",
  "HALF BOARD": "HB",
  "HALF BOARD PLUS": "HB",
  "HALF BOARD DINE AROUND": "HB",
  "HALF BOARD PREMIUM": "HB",
  "FULL BOARD": "FB",
  "FULL BOARD PLUS": "FB",
  "FULL BOARD DINE AROUND": "FB",
  "FULL BOARD PREMIUM": "FB",
  "ALL INCLUSIVE": "AI",
  "ALL INCLUSIVE PLUS": "AI",
  "ALL INCLUSIVE DINE AROUND": "AI",
  "ALL INCLUSIVE LIMITED": "AI",
  "SOFT ALL INCLUSIVE": "AI",
  "ULTRA ALL INCLUSIVE": "AI",
  "PREMIUM ALL INCLUSIVE": "AI",
};

export function resolveAoryxMealCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.toUpperCase().replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  return mealFamilies[value] ?? mealNames[value] ?? mealFamilies[value.split(/[\s-]/)[0]] ?? null;
}

export function normalizeAoryxMealSelection(input: unknown): string[] {
  const values = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  return Array.from(new Set(values.map(resolveAoryxMealCode).filter((code): code is string => Boolean(code))));
}
