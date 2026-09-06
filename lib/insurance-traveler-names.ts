type InsuranceNamesInput = {
  firstName?: unknown;
  lastName?: unknown;
  firstNameEn?: unknown;
  lastNameEn?: unknown;
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export const isArmenianInsuranceName = (value: unknown) =>
  /^[\u0531-\u0556\u0561-\u0587]+(?:[ -][\u0531-\u0556\u0561-\u0587]+)*$/u.test(text(value));

export const isEnglishInsuranceName = (value: unknown) =>
  /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/.test(text(value));

// These are separate legal-name fields. Never substitute one language for the other.
export const normalizeInsuranceTravelerNames = (traveler: InsuranceNamesInput) => ({
  firstName: text(traveler.firstName),
  lastName: text(traveler.lastName),
  firstNameEn: text(traveler.firstNameEn),
  lastNameEn: text(traveler.lastNameEn),
});

export class InsuranceTravelerNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsuranceTravelerNameError";
  }
}

export function assertInsuranceTravelerNames(traveler: InsuranceNamesInput, index: number) {
  if (!isArmenianInsuranceName(traveler.firstName) || !isArmenianInsuranceName(traveler.lastName)) {
    throw new InsuranceTravelerNameError(
      `Insurance traveler ${index + 1}: enter the first and last names in Armenian letters in the Armenian fields.`
    );
  }
  if (!isEnglishInsuranceName(traveler.firstNameEn) || !isEnglishInsuranceName(traveler.lastNameEn)) {
    throw new InsuranceTravelerNameError(
      `Insurance traveler ${index + 1}: enter the English first and last names in Latin letters as shown in the passport.`
    );
  }
}

// Called before starting checkout, and again before contacting EFES for old saved bookings.
export function assertEfesInsuranceNames(insurance: unknown) {
  if (!insurance || typeof insurance !== "object") return;
  const selection = insurance as { provider?: unknown; travelers?: unknown };
  const provider = text(selection.provider).toLowerCase();
  // Booking parsers default an omitted provider to EFES.
  if ((provider && provider !== "efes") || !Array.isArray(selection.travelers)) return;
  selection.travelers.forEach((traveler, index) => {
    assertInsuranceTravelerNames(
      traveler && typeof traveler === "object" ? traveler : {}, index
    );
  });
}

export function assertCheckoutInsuranceNames(body: unknown) {
  if (!body || typeof body !== "object") return;
  const record = body as { flow?: unknown; insurance?: unknown; addonServices?: unknown };
  const services = text(record.flow).toLowerCase() === "booking_addons" &&
    record.addonServices && typeof record.addonServices === "object"
    ? record.addonServices as { insurance?: unknown } : record;
  assertEfesInsuranceNames(services.insurance);
}
