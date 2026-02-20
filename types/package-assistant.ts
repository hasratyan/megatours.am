import type { Locale } from "@/lib/i18n";
import type {
  AoryxTransferChargeType,
  AoryxTransferLocation,
  AoryxTransferPricing,
  AoryxTransferVehicle,
} from "@/types/aoryx";

export type PackageAssistantApiRole = "user" | "assistant";

export type PackageAssistantApiMessage = {
  role: PackageAssistantApiRole;
  content: string;
};

export type PackageAssistantProgressEvent =
  | {
      type: "model_start";
      model: string;
      round: number;
    }
  | {
      type: "tool_call";
      tool: string;
    }
  | {
      type: "tool_result";
      tool: string;
      ok: boolean;
    }
  | {
      type: "finalizing";
    };

export type PackageAssistantContext = {
  destinationCode?: string | null;
  destinationName?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  roomCount?: number | null;
  adults?: number | null;
  children?: number | null;
  budgetAmount?: number | null;
  budgetCurrency?: string | null;
};

export type PackageAssistantHotelDraft = {
  selected: true;
  hotelCode?: string | null;
  hotelName?: string | null;
  destinationCode?: string | null;
  destinationName?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  roomCount?: number | null;
  guestCount?: number | null;
  mealPlan?: string | null;
  nonRefundable?: boolean | null;
  price?: number | null;
  currency?: string | null;
};

export type PackageAssistantTransferDraft = {
  selected: true;
  selectionId?: string | null;
  label?: string | null;
  price?: number | null;
  currency?: string | null;
  destinationName?: string | null;
  destinationCode?: string | null;
  transferOrigin?: string | null;
  transferDestination?: string | null;
  vehicleName?: string | null;
  vehicleMaxPax?: number | null;
  transferType?: string | null;
  includeReturn?: boolean | null;
  vehicleQuantity?: number | null;
  origin?: AoryxTransferLocation | null;
  destination?: AoryxTransferLocation | null;
  vehicle?: AoryxTransferVehicle | null;
  paxRange?: { minPax?: number | null; maxPax?: number | null } | null;
  pricing?: AoryxTransferPricing | null;
  validity?: { from?: string | null; to?: string | null } | null;
  chargeType?: AoryxTransferChargeType | null;
  paxCount?: number | null;
};

export type PackageAssistantFlightDraft = {
  selected: true;
  selectionId?: string | null;
  label?: string | null;
  price?: number | null;
  currency?: string | null;
  origin?: string | null;
  destination?: string | null;
  departureDate?: string | null;
  returnDate?: string | null;
  cabinClass?: string | null;
  notes?: string | null;
};

export type PackageAssistantExcursionDraft = {
  selected: true;
  label?: string | null;
  price?: number | null;
  currency?: string | null;
  items?: Array<{
    id: string;
    name?: string | null;
    price?: number | null;
    currency?: string | null;
  }>;
};

export type PackageAssistantInsuranceDraft = {
  selected: true;
  selectionId?: string | null;
  label?: string | null;
  price?: number | null;
  currency?: string | null;
  planId?: string | null;
  planLabel?: string | null;
  note?: string | null;
  riskAmount?: number | null;
  riskCurrency?: string | null;
  riskLabel?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  days?: number | null;
};

export type PackageAssistantDraft = {
  hotel?: PackageAssistantHotelDraft;
  transfer?: PackageAssistantTransferDraft;
  flight?: PackageAssistantFlightDraft;
  excursion?: PackageAssistantExcursionDraft;
  insurance?: PackageAssistantInsuranceDraft;
};

export type PackageAssistantPackageOption = {
  id: string;
  title: string;
  summary: string;
  confidence?: number | null;
  approxTotal?: {
    amount?: number | null;
    currency?: string | null;
    note?: string | null;
  } | null;
  highlights?: string[];
  draft: PackageAssistantDraft;
};

export type PackageAssistantReplyStage = "collecting" | "proposing" | "ready";

export type PackageAssistantReply = {
  message: string;
  stage: PackageAssistantReplyStage;
  missing: string[];
  followUps: string[];
  packageOptions: PackageAssistantPackageOption[];
};

export type PackageAssistantPriceAuditIssue = {
  optionId: string;
  service: "hotel" | "transfer" | "flight" | "excursion" | "insurance" | "total";
  reason: string;
  providedAmount?: number | null;
  providedCurrency?: string | null;
};

export type PackageAssistantPriceAudit = {
  status: "pass" | "fail";
  issues: PackageAssistantPriceAuditIssue[];
  checkedAt: string;
};

export type PackageAssistantRequest = {
  sessionId?: string | null;
  locale?: Locale;
  messages: PackageAssistantApiMessage[];
  context?: PackageAssistantContext | null;
  stream?: boolean;
};

export type PackageAssistantResponse =
  | {
      ok: true;
      sessionId: string;
      reply: PackageAssistantReply;
    }
  | {
      ok: false;
      error: string;
    };
