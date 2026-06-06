export type AmdRates = {
  USD: number;
  EUR: number;
  RUB: number;
};

export const DISPLAY_CURRENCY_QUERY_PARAM = "displayCurrency";

export const displayCurrencyOptions = [
  { code: "AMD", symbol: "\u058F", label: "AMD" },
  { code: "RUB", symbol: "\u20BD", label: "RUB" },
  { code: "USD", symbol: "$", label: "USD" },
] as const;

export type DisplayCurrency = (typeof displayCurrencyOptions)[number]["code"];

export type NormalizedAmount = {
  amount: number;
  currency: string;
  isConverted: boolean;
};

export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = "AMD";

const AMD_SYMBOL = "\u058F";
const EUR_SYMBOL = "\u20AC";
const RUB_SYMBOL = "\u20BD";

const GROUPING_SEPARATOR = ",";

const formatWholeNumber = (amount: number) => {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const absValue = Math.abs(rounded);
  const grouped = absValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, GROUPING_SEPARATOR);
  return `${sign}${grouped}`;
};

export const normalizeCurrencyCode = (currency: string | null | undefined) =>
  (currency ?? "USD").trim().toUpperCase();

export const resolveDisplayCurrency = (currency: string | null | undefined): DisplayCurrency => {
  const normalized = normalizeCurrencyCode(currency);
  return displayCurrencyOptions.some((option) => option.code === normalized)
    ? (normalized as DisplayCurrency)
    : DEFAULT_DISPLAY_CURRENCY;
};

export const convertToAmd = (
  amount: number,
  currency: string | null | undefined,
  rates: AmdRates
): number | null => {
  if (!Number.isFinite(amount)) return null;
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "AMD") return amount;
  if (normalized === "USD") return amount * rates.USD;
  if (normalized === "EUR") return amount * rates.EUR;
  if (normalized === "RUB") return amount * rates.RUB;
  return null;
};

const convertFromAmd = (
  amount: number,
  currency: DisplayCurrency,
  rates: AmdRates | null | undefined
): number | null => {
  if (!Number.isFinite(amount)) return null;
  if (currency === "AMD") return amount;
  if (!rates) return null;
  const rate = rates[currency];
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
};

export const normalizeAmount = (
  amount: number | null | undefined,
  currency: string | null | undefined,
  rates: AmdRates | null | undefined,
  displayCurrency: DisplayCurrency = DEFAULT_DISPLAY_CURRENCY
): NormalizedAmount | null => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const baseCurrency = normalizeCurrencyCode(currency);
  const targetCurrency = resolveDisplayCurrency(displayCurrency);
  if (!rates) {
    return { amount, currency: baseCurrency, isConverted: baseCurrency === targetCurrency };
  }
  const converted = convertToAmd(amount, baseCurrency, rates);
  if (converted === null) {
    return { amount, currency: baseCurrency, isConverted: baseCurrency === targetCurrency };
  }
  const displayAmount = convertFromAmd(converted, targetCurrency, rates);
  if (displayAmount === null) {
    return { amount: converted, currency: "AMD", isConverted: true };
  }
  return { amount: displayAmount, currency: targetCurrency, isConverted: baseCurrency !== targetCurrency };
};

export const formatCurrencyAmount = (
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string
): string | null => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  void locale;
  const safeCurrency = normalizeCurrencyCode(currency);
  try {
    const formattedNumber = formatWholeNumber(amount);
    if (safeCurrency === "AMD") return `${formattedNumber} ${AMD_SYMBOL}`;
    if (safeCurrency === "USD") return `$${formattedNumber}`;
    if (safeCurrency === "EUR") return `${EUR_SYMBOL}${formattedNumber}`;
    if (safeCurrency === "RUB") return `${formattedNumber} ${RUB_SYMBOL}`;
    return `${formattedNumber} ${safeCurrency}`;
  } catch {
    return `${safeCurrency} ${amount}`;
  }
};

export const formatNormalizedAmount = (
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
  rates: AmdRates | null | undefined,
  displayCurrency: DisplayCurrency = DEFAULT_DISPLAY_CURRENCY
): string | null => {
  const normalized = normalizeAmount(amount, currency, rates, displayCurrency);
  if (!normalized) return null;
  return formatCurrencyAmount(normalized.amount, normalized.currency, locale);
};

export const withDisplayCurrencyParam = (href: string, displayCurrency: DisplayCurrency): string => {
  if (!href || href.startsWith("http:") || href.startsWith("https:") || href.startsWith("mailto:")) {
    return href;
  }

  const markerOrigin = "https://megatours.local";
  const url = new URL(href, markerOrigin);
  const resolved = resolveDisplayCurrency(displayCurrency);
  if (resolved === DEFAULT_DISPLAY_CURRENCY) {
    url.searchParams.delete(DISPLAY_CURRENCY_QUERY_PARAM);
  } else {
    url.searchParams.set(DISPLAY_CURRENCY_QUERY_PARAM, resolved);
  }

  if (href.startsWith("#")) {
    return `${url.search}${url.hash}`;
  }
  return `${url.pathname}${url.search}${url.hash}`;
};
