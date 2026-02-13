import { randomUUID } from "crypto";
import { getB2bDb } from "@/lib/db";
import { createEfesPoliciesFromBooking } from "@/lib/efes-client";
import type { AoryxBookingPayload, AoryxBookingResult, AoryxTransferSelection } from "@/types/aoryx";

type ServiceStatus = "skipped" | "booked" | "failed";

type BaseServiceResult = {
  status: ServiceStatus;
  referenceId: string | null;
  message: string | null;
};

export type B2bServicesBookingResult = {
  transfer: BaseServiceResult;
  excursions: BaseServiceResult & { items: number | null };
  insurance: BaseServiceResult & {
    provider: "efes" | null;
    policies: Array<{ travelerId: string | null; response: unknown }> | null;
  };
};

type ProcessServicesInput = {
  requestId: string;
  clientId: string;
  payload: AoryxBookingPayload;
  booking: AoryxBookingResult;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.replace(/,/g, "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const buildReference = (prefix: string) => {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = randomUUID().slice(0, 8);
  return `${prefix}-${stamp}-${suffix}`;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;

export const validateTransferFlightDetailsForBooking = (
  transferSelection: AoryxTransferSelection | null | undefined
) => {
  if (!transferSelection) return;
  const flightDetails = transferSelection.flightDetails ?? null;
  const flightNumber = normalizeText(flightDetails?.flightNumber);
  const arrivalDateTime = normalizeText(flightDetails?.arrivalDateTime);

  if (!flightNumber || !arrivalDateTime) {
    throw new Error("Transfer flight details are required: flightNumber and arrivalDateTime.");
  }

  if (transferSelection.includeReturn === true) {
    const departureFlightNumber = normalizeText(flightDetails?.departureFlightNumber);
    const departureDateTime = normalizeText(flightDetails?.departureDateTime);
    if (!departureFlightNumber || !departureDateTime) {
      throw new Error(
        "Return transfer requires departure flight details: departureFlightNumber and departureDateTime."
      );
    }
  }
};

export const validateInsuranceDetailsForBooking = (insuranceInput: unknown) => {
  if (insuranceInput === null || insuranceInput === undefined) return;
  if (!isRecord(insuranceInput)) {
    throw new Error("Invalid insurance payload.");
  }

  const provider = normalizeText(insuranceInput.provider).toLowerCase();
  if (provider && provider !== "efes") {
    throw new Error("Unsupported insurance provider. Expected provider=efes.");
  }

  const territoryCode = normalizeText(insuranceInput.territoryCode);
  if (!territoryCode) {
    throw new Error("Missing insurance field: territoryCode.");
  }

  const riskAmount = toNumber(insuranceInput.riskAmount);
  if (riskAmount === null || riskAmount <= 0) {
    throw new Error("Missing insurance field: riskAmount.");
  }

  const riskCurrency = normalizeText(insuranceInput.riskCurrency);
  if (!riskCurrency) {
    throw new Error("Missing insurance field: riskCurrency.");
  }

  const travelersRaw = insuranceInput.travelers;
  if (!Array.isArray(travelersRaw) || travelersRaw.length === 0) {
    throw new Error("Missing insurance field: travelers.");
  }

  const requiredTravelerStringFields = [
    "firstName",
    "lastName",
    "birthDate",
    "passportNumber",
    "passportAuthority",
    "passportIssueDate",
    "passportExpiryDate",
    "citizenship",
    "mobilePhone",
    "email",
    "premiumCurrency",
  ] as const;
  const requiredAddressStringFields = ["full", "country", "region", "city"] as const;

  for (let index = 0; index < travelersRaw.length; index += 1) {
    const traveler = travelersRaw[index];
    if (!isRecord(traveler)) {
      throw new Error(`Incomplete insurance traveler field: travelers[${index}] must be an object.`);
    }

    for (const field of requiredTravelerStringFields) {
      if (!normalizeText(traveler[field])) {
        throw new Error(`Incomplete insurance traveler field: travelers[${index}].${field} is required.`);
      }
    }

    const gender = normalizeText(traveler.gender).toUpperCase();
    if (gender !== "M" && gender !== "F") {
      throw new Error(
        `Incomplete insurance traveler field: travelers[${index}].gender is required (M or F).`
      );
    }

    if (typeof traveler.residency !== "boolean") {
      throw new Error(`Incomplete insurance traveler field: travelers[${index}].residency is required.`);
    }

    const premium = toNumber(traveler.premium);
    if (premium === null || premium <= 0) {
      throw new Error(`Incomplete insurance traveler field: travelers[${index}].premium is required.`);
    }

    const address = traveler.address;
    if (!isRecord(address)) {
      throw new Error(`Incomplete insurance traveler field: travelers[${index}].address is required.`);
    }

    for (const field of requiredAddressStringFields) {
      if (!normalizeText(address[field])) {
        throw new Error(
          `Incomplete insurance traveler field: travelers[${index}].address.${field} is required.`
        );
      }
    }
  }
};

export async function processB2bBookingServices(
  input: ProcessServicesInput
): Promise<B2bServicesBookingResult> {
  const { requestId, clientId, payload, booking } = input;
  const transferSelection = payload.transferSelection ?? null;
  const excursionSelections = payload.excursions?.selections ?? [];
  const insuranceSelection = payload.insurance ?? null;

  const transferResult: B2bServicesBookingResult["transfer"] = transferSelection
    ? {
        status: "booked",
        referenceId: buildReference("TRF"),
        message: null,
      }
    : {
        status: "skipped",
        referenceId: null,
        message: null,
      };

  const excursionsResult: B2bServicesBookingResult["excursions"] =
    excursionSelections.length > 0
      ? {
          status: "booked",
          referenceId: buildReference("EXC"),
          message: null,
          items: excursionSelections.length,
        }
      : {
          status: "skipped",
          referenceId: null,
          message: null,
          items: 0,
        };

  let insuranceResult: B2bServicesBookingResult["insurance"] = {
    status: "skipped",
    referenceId: null,
    message: null,
    provider: null,
    policies: null,
  };

  if (insuranceSelection) {
    if (insuranceSelection.provider !== "efes") {
      insuranceResult = {
        status: "failed",
        referenceId: null,
        message: "Unsupported insurance provider. Expected provider=efes.",
        provider: null,
        policies: null,
      };
    } else {
      try {
        const policies = await createEfesPoliciesFromBooking(payload);
        insuranceResult = {
          status: "booked",
          referenceId: buildReference("INS"),
          message: null,
          provider: "efes",
          policies,
        };
      } catch (error) {
        insuranceResult = {
          status: "failed",
          referenceId: null,
          message: errorMessage(error, "Failed to issue EFES insurance policies."),
          provider: "efes",
          policies: null,
        };
      }
    }
  }

  const shouldPersist =
    transferSelection !== null || excursionSelections.length > 0 || insuranceSelection !== null;
  if (shouldPersist) {
    try {
      const db = await getB2bDb();
      await db.collection("b2b_service_bookings").insertOne({
        createdAt: new Date(),
        requestId,
        clientId,
        customerRefNumber: payload.customerRefNumber ?? null,
        hotelCode: payload.hotelCode,
        destinationCode: payload.destinationCode,
        checkInDate: payload.checkInDate ?? null,
        checkOutDate: payload.checkOutDate ?? null,
        bookingResult: booking,
        servicesPayload: {
          transferSelection,
          excursions: payload.excursions ?? null,
          insurance: payload.insurance ?? null,
        },
        servicesResult: {
          transfer: transferResult,
          excursions: excursionsResult,
          insurance: {
            ...insuranceResult,
            policies: insuranceResult.policies,
          },
        },
      });
    } catch (error) {
      const warning = errorMessage(error, "Failed to persist local service booking record.");
      console.error("[B2B][services] Persistence warning", error);
      if (transferResult.status === "booked" && !transferResult.message) {
        transferResult.message = warning;
      }
      if (excursionsResult.status === "booked" && !excursionsResult.message) {
        excursionsResult.message = warning;
      }
      if (insuranceResult.status === "booked" && !insuranceResult.message) {
        insuranceResult.message = warning;
      }
    }
  }

  return {
    transfer: transferResult,
    excursions: excursionsResult,
    insurance: insuranceResult,
  };
}
