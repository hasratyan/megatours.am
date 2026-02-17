const normalizeIntegerPart = (value: string) => value.replace(/^0+(?=\d)/, "");

export const normalizeLeadingZeroNumberValue = (value: string): string => {
  if (!value) return value;

  const hasSign = value.startsWith("-") || value.startsWith("+");
  const sign = hasSign ? value[0] : "";
  const unsignedValue = hasSign ? value.slice(1) : value;

  if (/^\d+$/.test(unsignedValue)) {
    return `${sign}${normalizeIntegerPart(unsignedValue)}`;
  }

  const decimalMatch = unsignedValue.match(/^(\d+)\.(\d*)$/);
  if (decimalMatch) {
    const normalizedInteger = normalizeIntegerPart(decimalMatch[1]);
    return `${sign}${normalizedInteger}.${decimalMatch[2]}`;
  }

  return value;
};

export const sanitizeLeadingZeroNumberInput = (input: HTMLInputElement) => {
  const normalizedValue = normalizeLeadingZeroNumberValue(input.value);
  if (normalizedValue !== input.value) {
    input.value = normalizedValue;
  }
};
