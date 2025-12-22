"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import SearchForm from "@/components/search-form";
import Loader from "@/components/loader";
import { postJson } from "@/lib/api-helpers";
import { parseSearchParams } from "@/lib/search-query";
import { useTranslations } from "@/components/language-provider";
import ImageGallery from "./ImageGallery";
import type {
  AoryxBookingPayload,
  AoryxBookingResult,
  AoryxHotelInfoResult,
  AoryxPreBookResult,
  AoryxRoomOption,
  AoryxRoomSearch,
  HotelInfo,
} from "@/types/aoryx";

function toFinite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatPrice(value: number | null, currency: string | null): string | null {
  if (value === null || value === undefined) return null;
  const safeCurrency = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${safeCurrency} ${value}`;
  }
}

const normalizeMealLabel = (value: string) => value.trim().toLowerCase();

const pickMealLabel = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getGroupMealLabel = (group: { option: AoryxRoomOption; items: AoryxRoomOption[] }) =>
  pickMealLabel(group.option.boardType) ??
  pickMealLabel(group.option.meal) ??
  pickMealLabel(group.items.find((item) => pickMealLabel(item.boardType))?.boardType) ??
  pickMealLabel(group.items.find((item) => pickMealLabel(item.meal))?.meal) ??
  null;

type GuestForm = {
  id: string;
  type: "Adult" | "Child";
  title: string;
  firstName: string;
  lastName: string;
  age: number;
};

type BookingRoomState = {
  roomIdentifier: number;
  rateKey: string;
  roomName: string | null;
  meal: string | null;
  rateType: string | null;
  refundable: boolean | null;
  bedTypes: string[];
  inclusions: string[];
  policies: NonNullable<AoryxRoomOption["policies"]>;
  remarks: NonNullable<AoryxRoomOption["remarks"]>;
  cancellationPolicy: string | null;
  price: {
    gross: number | null;
    net: number | null;
    tax: number | null;
  };
  guests: GuestForm[];
  childAges: number[];
};

type PrebookContext = {
  groupCode: number;
  rateKeys: string[];
  result: AoryxPreBookResult;
};

type IdramCheckoutResponse = {
  action: string;
  fields: Record<string, string>;
  billNo: string;
};

type RemarkVariant = "mandatory" | "warning" | "info" | "note";

type RemarkMeta = {
  label: string;
  icon: string;
  variant: RemarkVariant;
};

const REMARK_TYPE_META: Record<string, RemarkMeta> = {
  MANDATORY: { label: "Mandatory", icon: "priority_high", variant: "mandatory" },
  MANDATORYTAX: { label: "Mandatory Tax", icon: "receipt_long", variant: "mandatory" },
  MANDATORYFEE: { label: "Mandatory Fee", icon: "receipt_long", variant: "mandatory" },
  MANDATORYCHARGE: { label: "Mandatory Charge", icon: "receipt_long", variant: "mandatory" },
  OPTIONAL: { label: "Optional", icon: "info", variant: "info" },
  KNOWBEFOREYOUGO: { label: "Know Before You Go", icon: "travel_explore", variant: "warning" },
  DISCLAIMER: { label: "Disclaimer", icon: "gavel", variant: "warning" },
  NOTE: { label: "Note", icon: "sticky_note_2", variant: "note" },
};

const normalizeRemarkType = (input?: string | null) =>
  input ? input.replace(/[\s_-]/g, "").toUpperCase() : null;

const getRemarkMeta = (type?: string | null): RemarkMeta => {
  const normalized = normalizeRemarkType(type);
  if (normalized) {
    if (REMARK_TYPE_META[normalized]) return REMARK_TYPE_META[normalized];
    if (normalized.startsWith("MANDATORY")) return REMARK_TYPE_META.MANDATORY;
  }
  return {
    label: type?.trim() || "Info",
    icon: "info",
    variant: "info",
  };
};

const POLICY_TYPE_META: Record<string, RemarkMeta> = {
  CAN: { label: "Cancellation", icon: "event_busy", variant: "warning" },
  NOS: { label: "No Show", icon: "hotel", variant: "mandatory" },
  MOD: { label: "Modification", icon: "edit", variant: "info" },
};

const getPolicyMeta = (type?: string | null): RemarkMeta => {
  const normalized = normalizeRemarkType(type);
  if (normalized && POLICY_TYPE_META[normalized]) {
    return POLICY_TYPE_META[normalized];
  }
  return {
    label: type?.trim() || "Policy",
    icon: "policy",
    variant: "info",
  };
};

const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

const buildBookingGuests = (
  prebookResult: AoryxPreBookResult,
  rooms: AoryxRoomSearch[] | null
): BookingRoomState[] => {
  if (!rooms || rooms.length === 0) return [];
  const prebookRooms = prebookResult.rooms ?? [];
  const prebookByIdentifier = new Map<number, AoryxRoomOption>();
  prebookRooms.forEach((room, index) => {
    if (typeof room.roomIdentifier === "number") {
      prebookByIdentifier.set(room.roomIdentifier, room);
    } else {
      prebookByIdentifier.set(index + 1, room);
    }
  });

  return rooms.map((room, index) => {
    const prebookRoom = prebookByIdentifier.get(room.roomIdentifier) ?? prebookRooms[index];
    const roomIdentifier =
      (typeof prebookRoom?.roomIdentifier === "number" ? prebookRoom.roomIdentifier : null) ??
      room.roomIdentifier ??
      index + 1;
    const adultCount =
      (typeof prebookRoom?.adultCount === "number" ? prebookRoom.adultCount : null) ?? room.adults;
    const childAgesRaw =
      Array.isArray(prebookRoom?.childAges) && prebookRoom.childAges.length > 0
        ? prebookRoom.childAges
        : room.childrenAges;
    const childAges = Array.isArray(childAgesRaw)
      ? childAgesRaw.filter((age): age is number => typeof age === "number")
      : [];

    const guests: GuestForm[] = [
      ...Array.from({ length: Math.max(1, adultCount) }).map((_, guestIndex) => ({
        id: `room-${roomIdentifier}-adult-${guestIndex + 1}`,
        type: "Adult" as const,
        title: "Mr.",
        firstName: "",
        lastName: "",
        age: 30,
      })),
      ...childAges.map((age, guestIndex) => ({
        id: `room-${roomIdentifier}-child-${guestIndex + 1}`,
        type: "Child" as const,
        title: "Master",
        firstName: "",
        lastName: "",
        age: age ?? 5,
      })),
    ];

    return {
      roomIdentifier,
      rateKey: prebookRoom?.rateKey ?? "",
      roomName: prebookRoom?.name ?? null,
      meal: prebookRoom?.meal ?? prebookRoom?.boardType ?? null,
      rateType: prebookRoom?.rateType ?? null,
      refundable: prebookRoom?.refundable ?? null,
      bedTypes: prebookRoom?.bedTypes ?? [],
      inclusions: prebookRoom?.inclusions ?? [],
      policies: prebookRoom?.policies ?? [],
      remarks: prebookRoom?.remarks ?? [],
      cancellationPolicy: prebookRoom?.cancellationPolicy ?? null,
      price: {
        gross: prebookRoom?.price?.gross ?? null,
        net: prebookRoom?.price?.net ?? null,
        tax: prebookRoom?.price?.tax ?? null,
      },
      guests,
      childAges,
    };
  });
};

const validateBookingGuests = (rooms: BookingRoomState[]): string | null => {
  for (const room of rooms) {
    const adultCount = room.guests.filter((guest) => guest.type === "Adult").length;
    if (adultCount === 0) {
      return `Room ${room.roomIdentifier} must include at least one adult.`;
    }
    for (const guest of room.guests) {
      if (!guest.firstName.trim() || !guest.lastName.trim()) {
        return "Please enter first and last names for each guest.";
      }
      if (!Number.isFinite(guest.age) || guest.age < 0) {
        return "Guest ages must be valid numbers.";
      }
      if (guest.type === "Child" && guest.age > 17) {
        return "Child ages must be between 0 and 17.";
      }
      if (guest.type === "Adult" && guest.age < 18) {
        return "Adult guests must be 18 years or older.";
      }
    }
  }
  return null;
};

function decodeHtmlEntities(text: string): string {
  if (typeof window === "undefined") return text;
  const textArea = document.createElement("textarea");
  textArea.innerHTML = text;
  return textArea.value;
}

const formatPolicyDateTime = (iso?: string | null, time?: string | null) => {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    const base = iso.split("T")[0] ?? iso;
    return time ? `${base} ${time}` : base;
  }
  const formatted = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
  return time ? `${formatted} ${time}` : formatted;
};

const describePolicyPenalty = (
  condition: BookingRoomState["policies"][number]["conditions"][number],
  currency: string | null | undefined
) => {
  const parts: string[] = [];
  if (typeof condition.percentage === "number" && condition.percentage > 0) {
    parts.push(`${condition.percentage}%`);
  }
  if (typeof condition.nights === "number" && condition.nights > 0) {
    parts.push(`${condition.nights} night${condition.nights === 1 ? "" : "s"}`);
  }
  if (typeof condition.fixed === "number" && condition.fixed > 0) {
    const formatted = formatPrice(condition.fixed, currency ?? "USD");
    if (formatted) parts.push(formatted);
  }
  if (condition.text) {
    parts.push(condition.text);
  }
  return parts.length > 0 ? parts.join(" + ") : "Free cancellation";
};

const describePolicyCondition = (
  condition: BookingRoomState["policies"][number]["conditions"][number],
  currency: string | null | undefined
) => {
  const from = formatPolicyDateTime(condition.fromDate, condition.fromTime);
  const to = formatPolicyDateTime(condition.toDate, condition.toTime);
  const windowParts: string[] = [];
  if (from) windowParts.push(`From ${from}`);
  if (to) windowParts.push(`until ${to}`);
  const timeWindow = windowParts.length > 0 ? windowParts.join(" ") : null;
  const penalty = describePolicyPenalty(condition, currency);
  return timeWindow ? `${timeWindow} · ${penalty}` : penalty;
};

export default function HotelDetailsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const { data: session, status: authStatus } = useSession();

  const hotelCode = Array.isArray(params.code) ? params.code[0] : params.code;

  const parsed = useMemo(() => {
    const merged = new URLSearchParams(searchParams.toString());
    if (hotelCode) merged.set("hotelCode", hotelCode);
    return parseSearchParams(merged);
  }, [searchParams, hotelCode]);
  const destinationCode = parsed.payload?.destinationCode ?? searchParams.get("destinationCode") ?? undefined;

  const [hotelInfo, setHotelInfo] = useState<AoryxHotelInfoResult | null>(null);
  const [fallbackCoordinates, setFallbackCoordinates] = useState<{ lat: number; lon: number } | null>(
    null
  );
  const [roomOptions, setRoomOptions] = useState<AoryxRoomOption[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activePrebook, setActivePrebook] = useState<PrebookContext | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingGuests, setBookingGuests] = useState<BookingRoomState[]>([]);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingPreparing, setBookingPreparing] = useState(false);
  const [bookingResult, setBookingResult] = useState<AoryxBookingResult | null>(null);
  const [confirmPriceChange, setConfirmPriceChange] = useState(false);
  const [prebookingKey, setPrebookingKey] = useState<string | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [mealFilter, setMealFilter] = useState<string>("all");
  const [priceSort, setPriceSort] = useState<"default" | "asc" | "desc">("default");
  const [error, setError] = useState<string | null>(null);
  const amenitiesRef = useRef<HTMLDivElement | null>(null);
  const bookingPopoverRef = useRef<HTMLDivElement | null>(null);
  const [amenitiesExpanded, setAmenitiesExpanded] = useState(false);
  const [amenitiesOverflow, setAmenitiesOverflow] = useState(false);
  const finalError = error;

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setHotelInfo(null);
        setFallbackCoordinates(null);
        setError(null);
      }
    });

    if (!hotelCode) {
      return () => {
        cancelled = true;
      };
    }

    postJson<AoryxHotelInfoResult | null>("/api/aoryx/hotel-info", { hotelCode })
      .then((info) => {
        if (!cancelled) {
          setHotelInfo(info);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Unable to load this hotel right now.";
          setError(message);
          setHotelInfo(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hotelCode]);

  useEffect(() => {
    let cancelled = false;
    const infoLat = toFinite(hotelInfo?.geoCode?.lat);
    const infoLon = toFinite(hotelInfo?.geoCode?.lon);

    if (!hotelCode || !destinationCode || (infoLat !== null && infoLon !== null)) {
      queueMicrotask(() => {
        setFallbackCoordinates(null);
      });
      return () => {
        cancelled = true;
      };
    }

    postJson<{ hotels: HotelInfo[] }>("/api/aoryx/hotels-by-destination", {
      destinationId: destinationCode,
      parentDestinationId: destinationCode,
    })
      .then((response) => {
        if (cancelled) return;
        const match = (response.hotels ?? []).find((hotel) => hotel.systemId === hotelCode);
        const lat = toFinite(match?.latitude);
        const lon = toFinite(match?.longitude);
        setFallbackCoordinates(lat !== null && lon !== null ? { lat, lon } : null);
      })
      .catch(() => {
        if (!cancelled) setFallbackCoordinates(null);
      });

    return () => {
      cancelled = true;
    };
  }, [destinationCode, hotelCode, hotelInfo?.geoCode?.lat, hotelInfo?.geoCode?.lon]);

  const roomDetailsPayload = useMemo(() => {
    if (!parsed.payload || !hotelCode) return null;
    return { ...parsed.payload, hotelCode };
  }, [hotelCode, parsed.payload]);

  useEffect(() => {
    if (!roomDetailsPayload) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setRoomsLoading(true);
        setRoomsError(null);
        setRoomOptions([]);
        setSessionId(null);
        setActivePrebook(null);
        setBookingOpen(false);
        setBookingGuests([]);
        setBookingError(null);
        setBookingResult(null);
        setConfirmPriceChange(false);
        setPrebookingKey(null);
      }
    });

    postJson<{ rooms: AoryxRoomOption[]; sessionId?: string | null; currency?: string | null }>(
      "/api/aoryx/room-details",
      roomDetailsPayload
    )
      .then((response) => {
        if (!cancelled) {
          setRoomOptions(response.rooms ?? []);
          setSessionId(response.sessionId ?? null);
          setRoomsError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Unable to load room options.";
          setRoomsError(message);
          setRoomOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) setRoomsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [roomDetailsPayload]);

  useEffect(() => {
    queueMicrotask(() => setAmenitiesExpanded(false));
  }, [hotelInfo?.systemId]);

  useEffect(() => {
    const element = amenitiesRef.current;
    if (!element) return;

    const measure = () => {
      if (amenitiesExpanded) return;
      const isOverflowing = element.scrollHeight > element.clientHeight + 1;
      setAmenitiesOverflow(isOverflowing);
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [amenitiesExpanded, hotelInfo?.masterHotelAmenities]);

  useEffect(() => {
    const element = bookingPopoverRef.current;
    if (!element) return;
    const isOpen = element.matches?.(":popover-open");

    if (bookingOpen && element.showPopover && !isOpen) {
      element.showPopover();
    } else if (!bookingOpen && element.hidePopover && isOpen) {
      element.hidePopover();
    }
  }, [bookingOpen]);
  const roundedRating = Math.round(hotelInfo?.rating ?? 0);
  const galleryImages = useMemo(() => {
    const unique = new Set<string>();
    const add = (value?: string | null) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          unique.add(trimmed);
        }
      }
    };
    (hotelInfo?.imageUrls ?? []).forEach(add);
    return Array.from(unique);
  }, [hotelInfo?.imageUrls]);
  const hotelCoordinates = useMemo(() => {
    const lat = toFinite(hotelInfo?.geoCode?.lat) ?? fallbackCoordinates?.lat ?? null;
    const lon = toFinite(hotelInfo?.geoCode?.lon) ?? fallbackCoordinates?.lon ?? null;
    return lat !== null && lon !== null ? { lat, lon } : null;
  }, [fallbackCoordinates?.lat, fallbackCoordinates?.lon, hotelInfo?.geoCode?.lat, hotelInfo?.geoCode?.lon]);
  const mapPopoverId = "hotel-map-popover";
  const mapEmbedSrc = hotelCoordinates
    ? `https://www.google.com/maps?q=${hotelCoordinates.lat},${hotelCoordinates.lon}&output=embed`
    : null;
  const fallbackCurrency = hotelInfo?.currencyCode ?? parsed.payload?.currency ?? null;
  const tripAdvisorRating = hotelInfo?.tripAdvisorRating ?? null;
  const roomCount = roomDetailsPayload?.rooms.length ?? 1;
  const groupedRoomOptions = useMemo(() => {
    if (roomCount <= 1) {
      return roomOptions.map((option, index) => ({
        key: `${option.id}-${index}`,
        option,
        items: [option],
        totalPrice: option.totalPrice,
        currency: option.currency ?? fallbackCurrency,
      }));
    }

    const groups = new Map<
      string,
      { key: string; option: AoryxRoomOption; items: AoryxRoomOption[] }
    >();

    roomOptions.forEach((option) => {
      const groupKey = [
        option.id,
        option.boardType ?? "",
        option.refundable ?? "",
        option.cancellationPolicy ?? "",
      ].join("|");
      const existing = groups.get(groupKey);
      if (existing) {
        existing.items.push(option);
      } else {
        groups.set(groupKey, { key: groupKey, option, items: [option] });
      }
    });

    return Array.from(groups.values()).map((group) => {
      const items = group.items.slice(0, Math.max(1, roomCount));
      const hasAllPrices = items.every((item) => typeof item.totalPrice === "number");
      const totalPrice = hasAllPrices
        ? items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0)
        : null;
      const currency =
        group.option.currency ??
        fallbackCurrency ??
        items.find((item) => item.currency)?.currency ??
        null;

      return {
        ...group,
        items,
        totalPrice,
        currency,
      };
    });
  }, [fallbackCurrency, roomCount, roomOptions]);
  const mealOptions = useMemo(() => {
    const map = new Map<string, string>();
    groupedRoomOptions.forEach((group) => {
      const label = getGroupMealLabel(group);
      if (!label) return;
      const normalized = normalizeMealLabel(label);
      if (!map.has(normalized)) {
        map.set(normalized, label);
      }
    });
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [groupedRoomOptions]);
  useEffect(() => {
    if (mealFilter !== "all" && !mealOptions.some((option) => option.value === mealFilter)) {
      setMealFilter("all");
    }
  }, [mealFilter, mealOptions]);
  const visibleRoomOptions = useMemo(() => {
    let filtered = groupedRoomOptions;
    if (mealFilter !== "all") {
      filtered = filtered.filter((group) => {
        const label = getGroupMealLabel(group);
        return label ? normalizeMealLabel(label) === mealFilter : false;
      });
    }
    if (priceSort === "default") return filtered;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const aPrice = typeof a.totalPrice === "number" ? a.totalPrice : null;
      const bPrice = typeof b.totalPrice === "number" ? b.totalPrice : null;
      if (aPrice === null && bPrice === null) return 0;
      if (aPrice === null) return 1;
      if (bPrice === null) return -1;
      return priceSort === "asc" ? aPrice - bPrice : bPrice - aPrice;
    });
    return sorted;
  }, [groupedRoomOptions, mealFilter, priceSort]);
  const isFiltered = mealFilter !== "all" || priceSort !== "default";
  const bookingTotal = useMemo(() => {
    if (bookingGuests.length === 0) return null;
    const total = bookingGuests.reduce((sum, room) => {
      const price = isFiniteNumber(room.price.net)
        ? room.price.net
        : isFiniteNumber(room.price.gross)
          ? room.price.gross
          : 0;
      return sum + price;
    }, 0);
    return total > 0 ? total : null;
  }, [bookingGuests]);

  const presetDestination = destinationCode
    ? {
        id: destinationCode,
        label: destinationCode,
        rawId: destinationCode,
      }
    : undefined;

  const presetHotel = hotelCode
    ? {
        id: hotelCode,
        label: hotelInfo?.name ?? hotelCode,
      }
    : undefined;

  const initialDateRange = parsed.payload
    ? {
        startDate: new Date(`${parsed.payload.checkInDate}T00:00:00`),
        endDate: new Date(`${parsed.payload.checkOutDate}T00:00:00`),
      }
    : undefined;
  const nightsCount = useMemo(() => {
    if (!parsed.payload?.checkInDate || !parsed.payload?.checkOutDate) return null;
    const checkInDate = new Date(`${parsed.payload.checkInDate}T00:00:00`);
    const checkOutDate = new Date(`${parsed.payload.checkOutDate}T00:00:00`);
    if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) return null;
    const diffTime = checkOutDate.getTime() - checkInDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : null;
  }, [parsed.payload?.checkInDate, parsed.payload?.checkOutDate]);
  const night = nightsCount ? `${nightsCount} night${nightsCount === 1 ? "" : "s"}` : "night";

  const initialRooms = parsed.payload?.rooms.map((room) => ({
    adults: room.adults,
    children: room.childrenAges.length,
    childAges: room.childrenAges,
  }));
  const handleSearchSubmit = useCallback(
    (payload: { hotelCode?: string }, params: URLSearchParams) => {
      const resolvedHotelCode = payload.hotelCode ?? hotelCode ?? undefined;
      if (resolvedHotelCode) {
        params.set("hotelCode", resolvedHotelCode);
      }
      const query = params.toString();
      const nextHref = query ? `${pathname}?${query}` : pathname;
      router.replace(nextHref);
    },
    [hotelCode, pathname, router]
  );

  const isSignedIn = Boolean(session?.user);

  const bookingCurrency =
    activePrebook?.result.currency ??
    fallbackCurrency ??
    parsed.payload?.currency ??
    "USD";

  const updateGuestField = useCallback(
    (roomIdentifier: number, guestId: string, field: keyof GuestForm, value: string | number) => {
      setBookingGuests((prev) =>
        prev.map((room) => {
          if (room.roomIdentifier !== roomIdentifier) return room;
          return {
            ...room,
            guests: room.guests.map((guest) =>
              guest.id === guestId
                ? {
                    ...guest,
                    [field]: field === "age" ? Number(value) : value,
                  }
                : guest
            ),
          };
        })
      );
    },
    []
  );

  const handlePrebook = useCallback(
    async (group: { key: string; option: AoryxRoomOption; items: AoryxRoomOption[] }) => {
      if (authStatus === "loading") {
        setBookingError("Checking sign-in status. Please try again.");
        return;
      }
      if (!isSignedIn) {
        const query = searchParams.toString();
        const callbackUrl = query ? `${pathname}?${query}` : pathname;
        setBookingError("Please sign in to book this room.");
        void signIn("google", { callbackUrl });
        return;
      }
      if (!hotelCode) return;
      if (!sessionId) {
        setBookingError("Missing session details. Please run the search again.");
        return;
      }

      const resolvedGroupCode =
        group.option.groupCode ??
        group.items.find((item) => typeof item.groupCode === "number")?.groupCode ??
        null;
      const groupCode =
        typeof resolvedGroupCode === "number" && Number.isFinite(resolvedGroupCode)
          ? resolvedGroupCode
          : null;
      const rateKeys = group.items
        .map((item) => item.rateKey)
        .filter((key): key is string => typeof key === "string" && key.length > 0);

      if (groupCode === null) {
        setBookingError("This room option cannot be booked right now. Please try another option.");
        return;
      }
      if (rateKeys.length === 0) {
        setBookingError("Missing rate keys for this room option. Please try another option.");
        return;
      }

      const prebookCurrency = fallbackCurrency ?? parsed.payload?.currency ?? "USD";
      setBookingPreparing(true);
      setPrebookingKey(group.key);
      setBookingError(null);
      setBookingResult(null);
      setConfirmPriceChange(false);

      try {
        const result = await postJson<AoryxPreBookResult>("/api/aoryx/prebook", {
          sessionId,
          hotelCode,
          groupCode,
          rateKeys,
          currency: prebookCurrency,
        });
        const guests = buildBookingGuests(result, roomDetailsPayload?.rooms ?? null);
        if (guests.length === 0) {
          setBookingError("Unable to build guest details for this selection.");
          return;
        }
        setActivePrebook({ groupCode, rateKeys, result });
        setBookingGuests(guests);
        setBookingOpen(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to prebook rate";
        setBookingError(message);
      } finally {
        setBookingPreparing(false);
        setPrebookingKey(null);
      }
    },
    [
      authStatus,
      fallbackCurrency,
      hotelCode,
      isSignedIn,
      parsed.payload?.currency,
      pathname,
      roomDetailsPayload?.rooms,
      searchParams,
      sessionId,
    ]
  );

  const handleCloseBooking = useCallback(() => {
    setBookingOpen(false);
    setBookingError(null);
    setBookingResult(null);
    setActivePrebook(null);
    setBookingGuests([]);
    setConfirmPriceChange(false);
    setBookingLoading(false);
    setBookingPreparing(false);
  }, []);

  const handleBook = useCallback(async () => {
    if (!activePrebook || !hotelCode) return;
    if (authStatus === "loading") {
      setBookingError("Checking sign-in status. Please try again.");
      return;
    }
    if (!isSignedIn) {
      const query = searchParams.toString();
      const callbackUrl = query ? `${pathname}?${query}` : pathname;
      setBookingError("Please sign in to complete the booking.");
      void signIn("google", { callbackUrl });
      return;
    }

    const guestError = validateBookingGuests(bookingGuests);
    if (guestError) {
      setBookingError(guestError);
      return;
    }

    if (activePrebook.result.isPriceChanged && !confirmPriceChange) {
      setBookingError("Please confirm the updated price before booking.");
      return;
    }

    const bookingSessionId = activePrebook.result.sessionId ?? sessionId;
    if (!bookingSessionId) {
      setBookingError("Missing session details. Please prebook again.");
      return;
    }

    const destination =
      parsed.payload?.destinationCode ??
      destinationCode ??
      "";
    if (!destination) {
      setBookingError("Missing destination code. Please search again.");
      return;
    }

    let leadAssigned = false;
    const roomsPayload: AoryxBookingPayload["rooms"] = [];

    for (const room of bookingGuests) {
      if (!room.rateKey) {
        setBookingError(`Room ${room.roomIdentifier} is missing a rate key.`);
        return;
      }

      const gross = isFiniteNumber(room.price.gross)
        ? room.price.gross
        : isFiniteNumber(room.price.net)
          ? room.price.net
          : null;
      const net = isFiniteNumber(room.price.net)
        ? room.price.net
        : isFiniteNumber(room.price.gross)
          ? room.price.gross
          : null;
      const tax = isFiniteNumber(room.price.tax) ? room.price.tax : 0;

      if (gross === null || net === null) {
        setBookingError(`Room ${room.roomIdentifier} is missing price details.`);
        return;
      }

      const guests = room.guests.map((guest) => {
        const isLeadGuest = !leadAssigned && guest.type === "Adult";
        if (isLeadGuest) {
          leadAssigned = true;
        }
        return {
          title: guest.title,
          titleCode: "",
          firstName: guest.firstName.trim(),
          lastName: guest.lastName.trim(),
          isLeadGuest,
          type: guest.type,
          age: guest.age,
        };
      });

      const adults = guests.filter((guest) => guest.type === "Adult").length;
      const childrenAges = guests
        .filter((guest) => guest.type === "Child")
        .map((guest) => guest.age);

      roomsPayload.push({
        roomIdentifier: room.roomIdentifier,
        adults,
        childrenAges,
        rateKey: room.rateKey,
        guests,
        price: {
          gross,
          net,
          tax,
        },
      });
    }

    if (!leadAssigned && roomsPayload[0]?.guests[0]) {
      roomsPayload[0].guests[0].isLeadGuest = true;
    }

    const payload: AoryxBookingPayload = {
      sessionId: bookingSessionId,
      hotelCode,
      destinationCode: destination,
      countryCode: parsed.payload?.countryCode ?? "AE",
      currency: bookingCurrency,
      nationality: parsed.payload?.nationality ?? "AM",
      customerRefNumber: `MEGA-${Date.now()}`,
      groupCode: activePrebook.groupCode,
      rooms: roomsPayload,
      acknowledgePriceChange: Boolean(confirmPriceChange),
    };

    setBookingLoading(true);
    setBookingError(null);
    setBookingResult(null);

    try {
      const checkout = await postJson<IdramCheckoutResponse>("/api/payments/idram/checkout", payload);
      if (typeof document === "undefined") {
        throw new Error("Unable to redirect to payment.");
      }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = checkout.action;
      Object.entries(checkout.fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start payment.";
      setBookingError(message);
      setBookingLoading(false);
    }
  }, [
    activePrebook,
    authStatus,
    bookingCurrency,
    bookingGuests,
    confirmPriceChange,
    destinationCode,
    hotelCode,
    isSignedIn,
    pathname,
    parsed.payload?.countryCode,
    parsed.payload?.destinationCode,
    parsed.payload?.nationality,
    searchParams,
    sessionId,
  ]);

  return (
      <main
        className="details"
        style={{
          "--background-image": hotelInfo?.imageUrl ? `url(${hotelInfo.imageUrl})` : "none"
        } as React.CSSProperties}
      >
        <div className="container header">
          <section>
            <h1>{hotelInfo?.name}</h1>
            <span className="rating">
              {[...Array(5)].map((_, i) => (
                <span
                  key={i}
                  className={`material-symbols-rounded${i < roundedRating ? " fill" : ""}`}
                >
                  star
                </span>
              ))}
            </span>
            {hotelInfo?.address && (
              <p>{hotelInfo?.address?.line1}, {hotelInfo?.address?.cityName}</p>
            )}
            {(hotelInfo?.contact?.phone || hotelInfo?.contact?.website) && (
              <div>
                {hotelInfo?.contact?.phone &&(
                  <a href={`tel:${hotelInfo.contact.phone}`}>
                    <span className="material-symbols-rounded">phone</span>
                    {hotelInfo.contact.phone}
                  </a>
                )}
                {hotelInfo?.contact?.website && (
                  <a href={hotelInfo.contact.website} target="_blank" rel="noopener noreferrer">
                    <span className="material-symbols-rounded">language</span>
                    {hotelInfo.contact.website}
                  </a>
                )}
              </div>
            )}
            {hotelCoordinates && mapEmbedSrc && (
              <button
                type="button"
                className="map-button"
                popoverTarget={mapPopoverId}
                aria-label="View hotel on map"
              >
                <span className="material-symbols-rounded">map</span>
                Show location on Map
              </button>
            )}
          </section>
          {typeof tripAdvisorRating === "number" && tripAdvisorRating > 0 && (
            <div className="tripadvisor">
              <svg xmlns="http://www.w3.org/2000/svg" width="125" height="31.923" viewBox="0 0 150 31.923"><path fillRule="evenodd" fill="#fff" d="M149.96 22.158c0 0.465 -0.376 0.845 -0.841 0.845s-0.845 -0.38 -0.845 -0.845 0.38 -0.841 0.845 -0.841 0.841 0.376 0.841 0.841M148.39 10.748h1.458V13.636h-1.708c-1.319 0 -2.164 0.648 -2.164 1.967v7.27h-3.125V10.748h3.125V12.787c0.277 -1.444 1.27 -2.039 2.414 -2.039m1.44 11.41c0 -0.389 -0.322 -0.706 -0.711 -0.706 -0.393 0 -0.711 0.317 -0.711 0.706s0.317 0.711 0.711 0.711c0.389 0 0.711 -0.322 0.711 -0.711m-0.572 0.076 0.152 0.304h-0.143l-0.139 -0.277h-0.143v0.277h-0.13v-0.769h0.268c0.161 0 0.268 0.094 0.268 0.246 0 0.103 -0.054 0.179 -0.134 0.219m-99.3 -11.486h1.462V13.636h-1.708c-1.319 0 -2.164 0.648 -2.164 1.967v7.27h-3.125V10.748h3.125V12.787c0.273 -1.444 1.265 -2.039 2.41 -2.039m6.282 -2.884c0 1.042 -0.823 1.887 -1.891 1.887s-1.887 -0.845 -1.887 -1.887c0 -1.073 0.818 -1.914 1.887 -1.914s1.891 0.841 1.891 1.914m-3.452 2.884h3.121v12.125h-3.121zm17.978 6.067c0 3.461 -2.808 6.268 -6.273 6.268 -1.395 0 -2.665 -0.456 -3.68 -1.23v4.587h-3.116v-15.693h3.116v1.028c1.015 -0.773 2.285 -1.23 3.68 -1.23 3.465 0 6.273 2.803 6.273 6.268m-3.139 0c0 -1.882 -1.525 -3.407 -3.407 -3.407s-3.407 1.525 -3.407 3.407c0 1.878 1.525 3.407 3.407 3.407s3.407 -1.525 3.407 -3.407m60.3 2.235c0 2.338 -2.007 4.037 -4.77 4.037 -2.87 0 -4.873 -1.739 -4.873 -4.23v-0.067h3.054v0.067c0 1.037 0.742 1.739 1.846 1.739 1.06 0 1.77 -0.519 1.77 -1.288 0 -0.729 -0.492 -1.136 -1.82 -1.502l-1.739 -0.474c-1.833 -0.496 -2.884 -1.69 -2.884 -3.273 0 -2.039 1.923 -3.514 4.569 -3.514 2.674 0 4.466 1.475 4.466 3.68v0.067h-2.875v-0.067c0 -0.751 -0.697 -1.332 -1.592 -1.332 -0.939 0 -1.592 0.429 -1.592 1.046 0 0.63 0.465 1.001 1.663 1.31l1.82 0.501c2.441 0.653 2.955 2.151 2.955 3.3M81.827 10.748h3.121v12.13h-3.121v-1.024c-1.015 0.773 -2.28 1.23 -3.68 1.23 -3.461 0 -6.268 -2.808 -6.268 -6.268 0 -3.465 2.808 -6.268 6.268 -6.268 1.399 0 2.665 0.456 3.68 1.23zm0 6.063c0 -1.878 -1.525 -3.402 -3.407 -3.402 -1.878 0 -3.402 1.525 -3.402 3.402 0 1.882 1.525 3.407 3.402 3.407 1.882 0 3.407 -1.525 3.407 -3.407m14.379 -10.377h3.121v16.444h-3.121v-1.024c-1.015 0.773 -2.28 1.23 -3.68 1.23 -3.461 0 -6.268 -2.808 -6.268 -6.268 0 -3.465 2.808 -6.268 6.268 -6.268 1.399 0 2.665 0.456 3.68 1.23zm0 10.382c0 -1.882 -1.525 -3.407 -3.402 -3.407 -1.882 0 -3.407 1.525 -3.407 3.407 0 1.878 1.525 3.407 3.407 3.407 1.878 0 3.402 -1.525 3.402 -3.407m17.602 -6.067h3.116v12.13h-3.116zm3.447 -2.884c0 1.046 -0.818 1.891 -1.891 1.891 -1.069 0 -1.887 -0.845 -1.887 -1.891 0 -1.069 0.818 -1.914 1.887 -1.914 1.073 0 1.891 0.845 1.891 1.914m24.152 8.951c0 3.461 -2.808 6.268 -6.268 6.268 -3.465 0 -6.268 -2.808 -6.268 -6.268 0 -3.465 2.803 -6.273 6.268 -6.273 3.461 0 6.268 2.808 6.268 6.273m-2.861 0c0 -1.882 -1.529 -3.407 -3.407 -3.407 -1.882 0 -3.407 1.525 -3.407 3.407 0 1.878 1.525 3.402 3.407 3.402 1.878 0 3.407 -1.52 3.407 -3.402m-92.593 -10.382v2.781h-4.426v13.663h-3.107V9.215h-4.431v-2.781zM109.225 10.748h3.277l-4.185 12.13h-3.756l-4.158 -12.13h3.273l2.776 8.808zm40.033 11.267c0 -0.08 -0.054 -0.125 -0.143 -0.125h-0.13v0.255h0.13c0.085 0 0.143 -0.045 0.143 -0.13"></path><path fill="#34e0a1" d="M15.948 31.9C7.131 31.9 0 24.769 0 15.948 0 7.131 7.131 0 15.948 0 24.769 0 31.9 7.131 31.9 15.948c0 8.821 -7.131 15.952 -15.952 15.952"></path><path fillRule="evenodd" d="M27.72 17.186c0 3.25 -2.638 5.884 -5.888 5.884 -1.542 0 -2.946 -0.595 -3.997 -1.565l-1.887 2.048 -1.882 -2.052c-1.051 0.975 -2.459 1.569 -4.001 1.569 -3.246 0 -5.879 -2.633 -5.879 -5.884 0 -1.721 0.738 -3.273 1.918 -4.346l-1.927 -2.097h4.279c2.133 -1.458 4.708 -2.307 7.493 -2.307 2.794 0 5.374 0.849 7.511 2.307h4.265l-1.923 2.097c1.18 1.073 1.918 2.624 1.918 4.346m-13.672 0c0 -2.2 -1.779 -3.979 -3.979 -3.979s-3.984 1.779 -3.984 3.979 1.784 3.984 3.984 3.984 3.979 -1.784 3.979 -3.984m6.322 -5.946c-1.359 -0.568 -2.852 -0.881 -4.422 -0.881 -1.565 0 -3.058 0.313 -4.417 0.881 2.517 0.961 4.422 3.21 4.422 5.83 0 -2.62 1.905 -4.864 4.417 -5.83m5.446 5.946c0 -2.2 -1.779 -3.979 -3.979 -3.979s-3.984 1.779 -3.984 3.979 1.784 3.984 3.984 3.984 3.979 -1.784 3.979 -3.984m-1.896 0c0 1.154 -0.93 2.083 -2.083 2.083s-2.088 -0.93 -2.088 -2.083 0.934 -2.088 2.088 -2.088 2.083 0.934 2.083 2.088m-11.768 0c0 1.154 -0.93 2.088 -2.083 2.088s-2.088 -0.934 -2.088 -2.088 0.934 -2.088 2.088 -2.088 2.083 0.934 2.083 2.088"></path></svg>
              {tripAdvisorRating.toFixed(1)}
            </div>
          )}
          {/* <button type="button" onClick={() => router.back()}>
            <span className="material-symbols-rounded">arrow_back</span>Go back
          </button> */}
        </div>

          {finalError && (
            <div className="results-error">
              <p>{finalError}</p>
              <div className="results-error-actions">
                <Link href="/" className="btn btn-primary">Back to search</Link>
              </div>
            </div>
          )}

          {!finalError && galleryImages.length > 0 && (
              <ImageGallery
                images={galleryImages}
                altText={hotelInfo?.name ?? "Hotel"}
              />
          )}

          {!finalError && (
            <div className="container">
              {hotelInfo?.masterHotelAmenities?.length ? (
                <div className="amenities-wrapper">
                  <h2>Hotel Amenities</h2>
                  <div
                    ref={amenitiesRef}
                    className={`amenities${amenitiesExpanded ? " is-expanded" : ""}`}
                    id="hotel-amenities"
                  >
                    {hotelInfo.masterHotelAmenities.map((amenity, index) => (
                      <span key={`${amenity}-${index}`}>{amenity}</span>
                    ))}
                  </div>
                  {amenitiesOverflow && (
                    <button
                      type="button"
                      className="amenities-toggle"
                      aria-expanded={amenitiesExpanded}
                      aria-controls="hotel-amenities"
                      onClick={() => setAmenitiesExpanded((prev) => !prev)}
                    >
                      <span className="material-symbols-rounded">
                        {amenitiesExpanded ? "expand_less" : "expand_more"}
                      </span>
                      {amenitiesExpanded ? "Show less" : "Show all amenities"}
                    </button>
                  )}
                </div>
              ) : null}
              <div className="search">
                <h2>Create your next increadable experience.</h2>
                <SearchForm
                  copy={t.search}
                  hideLocationFields
                  presetDestination={presetDestination}
                  presetHotel={presetHotel}
                  initialDateRange={initialDateRange}
                  initialRooms={initialRooms}
                  showRoomCount
                  onSubmitSearch={handleSearchSubmit}
                />
              </div>
            </div>
          )}

          {!finalError && (
            <div className="room-options">
              <div className="container">
                {roomDetailsPayload && roomsLoading && (
                  <Loader text="Loading room options" />
                )}
                {roomDetailsPayload && !roomsLoading && roomsError && (
                  <p className="room-options-error">{roomsError}</p>
                )}
                {roomDetailsPayload && !roomsLoading && !roomsError && groupedRoomOptions.length === 0 && (
                  <p className="room-options-empty">No room options available.</p>
                )}
                {roomDetailsPayload && !roomsLoading && !roomsError && groupedRoomOptions.length > 0 && (
                  <>
                    <div className="room-options-header">
                      <h2>
                        {visibleRoomOptions.length} room options
                        {isFiltered && groupedRoomOptions.length !== visibleRoomOptions.length && (
                          <> of {groupedRoomOptions.length}</>
                        )}
                      </h2>
                      <div className="room-options-controls">
                        <label className="room-filter">
                          <span>Meal</span>
                          <select
                            value={mealFilter}
                            onChange={(event) => setMealFilter(event.target.value)}
                            disabled={mealOptions.length === 0}
                          >
                            <option value="all">All meals</option>
                            {mealOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="room-filter">
                          <span>Price</span>
                          <select
                            value={priceSort}
                            onChange={(event) =>
                              setPriceSort(event.target.value as "default" | "asc" | "desc")
                            }
                          >
                            <option value="default">Recommended</option>
                            <option value="asc">Lowest price</option>
                            <option value="desc">Highest price</option>
                          </select>
                        </label>
                      </div>
                    </div>
                    {!bookingOpen && bookingError && (
                      <p className="room-options-error booking-error">{bookingError}</p>
                    )}
                    {visibleRoomOptions.length === 0 ? (
                      <p className="room-options-empty">No room options match the current filters.</p>
                    ) : (
                      <div className="room-options-list">
                        {visibleRoomOptions.map((group) => {
                          const price = formatPrice(
                            group.totalPrice,
                            group.currency ?? fallbackCurrency
                          );
                          const rateKeys = group.items
                            .map((item) => item.rateKey)
                            .filter((key): key is string => typeof key === "string" && key.length > 0);
                          const groupCode =
                            group.option.groupCode ??
                            group.items.find((item) => typeof item.groupCode === "number")?.groupCode ??
                            null;
                          const canBook =
                            Boolean(sessionId) &&
                            Number.isFinite(groupCode) &&
                            rateKeys.length > 0;
                          const isPrebooking = prebookingKey === group.key;
                          return (
                            <div key={group.key} className="room-card">
                              <div className="room-card-main">
                                <h3>{group.option.name ?? "Room option"}</h3>
                                <div className="room-meta">
                                  {group.option.boardType && (
                                    <span className="room-chip">{group.option.boardType}</span>
                                  )}
                                  {group.option.refundable !== null && (
                                    <span
                                      className={`room-chip ${
                                        group.option.refundable ? "refundable" : "non-refundable"
                                      }`}
                                    >
                                      {group.option.refundable ? "Refundable" : "Non-refundable"}
                                    </span>
                                  )}
                                  {typeof group.option.availableRooms === "number" && (
                                    <span className="room-chip">{group.option.availableRooms} left</span>
                                  )}
                                </div>
                                {group.option.cancellationPolicy && (
                                  <p className="room-policy">{group.option.cancellationPolicy}</p>
                                )}
                              </div>
                              <div className="room-card-price">
                                {price ? (
                                  <span className="room-price">{price} <span>/ {night}</span></span>
                                ) : (
                                  <span className="room-price-muted">Contact for rates</span>
                                )}
                                {roomCount > 1 && (
                                  <div className="room-breakdown">
                                    {group.items.map((item, itemIndex) => {
                                      const itemPrice = formatPrice(
                                        item.totalPrice,
                                        item.currency ?? group.currency ?? fallbackCurrency
                                      );
                                      return (
                                        <span
                                          key={`${group.key}-${itemIndex}`}
                                          className="room-breakdown-item"
                                        >
                                          Room {itemIndex + 1}: {itemPrice ?? "Contact"}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                                <div className="room-card-actions">
                                  <button
                                    type="button"
                                    className="room-book-button"
                                    disabled={(!canBook && isSignedIn) || bookingPreparing}
                                    onClick={() => handlePrebook(group)}
                                  >
                                    {!isSignedIn
                                      ? "Sign in to book"
                                      : isPrebooking
                                      ? "Checking availability..."
                                      : "Book now"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {bookingOpen && (
            <div
              id="booking-popover"
              popover="manual"
              className="popover booking-popover"
              ref={bookingPopoverRef}
              aria-busy={bookingLoading || bookingPreparing}
            >
              <h2>{hotelInfo?.name ?? "Guest details"}</h2>
              {bookingResult ? (
                <div className="booking-success">
                  <p>Your booking request was submitted successfully.</p>
                  {bookingResult.adsConfirmationNumber && (
                    <p>Confirmation number: {bookingResult.adsConfirmationNumber}</p>
                  )}
                  {bookingResult.status && <p>Status: {bookingResult.status}</p>}
                  <div className="booking-actions">
                    <button type="button" className="booking-primary" onClick={handleCloseBooking}>
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="booking-body">
                  {activePrebook?.result.isPriceChanged && (
                    <p className="booking-warning">
                      Price changed during verification. Please confirm the updated price before booking.
                    </p>
                  )}
                  {activePrebook?.result.isPriceChanged && (
                    <label className="booking-confirm">
                      <input
                        type="checkbox"
                        checked={confirmPriceChange}
                        onChange={(event) => setConfirmPriceChange(event.target.checked)}
                      />
                      I accept the updated price and wish to proceed.
                    </label>
                  )}
                  {bookingError && <b className="booking-error">{bookingError}</b>}
                  {bookingGuests.map((room) => (
                    <fieldset key={room.roomIdentifier} className="booking-room">
                      <legend>
                        Room {room.roomIdentifier}
                        {room.roomName ? ` · ${room.roomName}` : ""}
                      </legend>
                      {room.guests.map((guest) => (
                        <div key={guest.id} className="booking-guest">
                          <select
                            value={guest.title}
                            onChange={(event) =>
                              updateGuestField(room.roomIdentifier, guest.id, "title", event.target.value)
                            }
                          >
                            <option>Mr.</option>
                            <option>Ms.</option>
                            <option>Mrs.</option>
                            {guest.type === "Child" && <option>Master</option>}
                          </select>
                          <input
                            type="text"
                            placeholder="First name"
                            value={guest.firstName}
                            onChange={(event) =>
                              updateGuestField(room.roomIdentifier, guest.id, "firstName", event.target.value)
                            }
                          />
                          <input
                            type="text"
                            placeholder="Last name"
                            value={guest.lastName}
                            onChange={(event) =>
                              updateGuestField(room.roomIdentifier, guest.id, "lastName", event.target.value)
                            }
                          />
                          <input
                            type="number"
                            min={guest.type === "Adult" ? 18 : 0}
                            max={guest.type === "Adult" ? 99 : 17}
                            value={guest.age}
                            readOnly={guest.type === "Child"}
                            onChange={(event) =>
                              updateGuestField(room.roomIdentifier, guest.id, "age", event.target.value)
                            }
                          />
                        </div>
                      ))}
                      <div className="booking-room-details">
                        <div className="booking-detail-grid">
                          {room.meal && <span>Meal plan: {room.meal}</span>}
                          {room.rateType && <span>Rate type: {room.rateType}</span>}
                          {room.refundable !== null && (
                            <span>{room.refundable ? "Refundable" : "Non-refundable"}</span>
                          )}
                          {room.bedTypes.length > 0 && (
                            <span>Bed type{room.bedTypes.length > 1 ? "s" : ""}: {room.bedTypes.join(", ")}</span>
                          )}
                          {room.inclusions.length > 0 && (
                            <span>Inclusions: {room.inclusions.join(", ")}</span>
                          )}
                        </div>
                        {(room.policies.length > 0 || room.cancellationPolicy) && (
                          <div className="booking-policy">
                            <h4>Cancellation policy</h4>
                            {room.policies.length > 0 ? (
                              <div className="remark-grid">
                                {room.policies.map((policy, index) => {
                                  const meta = getPolicyMeta(policy.type);
                                  const key = `${room.roomIdentifier}-policy-${index}`;
                                  return (
                                    <div key={key} className={`remark-card ${meta.variant}`}>
                                      <b className={`remark-chip ${meta.variant}`}>
                                        <span className="material-symbols-rounded" aria-hidden="true">
                                          {meta.icon}
                                        </span>
                                        {meta.label}
                                      </b>
                                      {policy.textCondition && (
                                        <p className="policy-summary">{policy.textCondition}</p>
                                      )}
                                      {policy.conditions.length > 0 ? (
                                        <ul className="policy-conditions">
                                          {policy.conditions.map((condition, conditionIndex) => (
                                            <li key={`${key}-condition-${conditionIndex}`}>
                                              {describePolicyCondition(
                                                condition,
                                                policy.currency ?? bookingCurrency
                                              )}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p className="policy-summary">No penalty details provided.</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="policy-summary">{room.cancellationPolicy}</p>
                            )}
                          </div>
                        )}
                        {room.remarks.length > 0 && (
                          <div className="booking-remarks">
                            <h4>Remarks</h4>
                            <div className="remark-grid">
                              {room.remarks.map((remark, index) => {
                                const meta = getRemarkMeta(remark.type);
                                const key = `${room.roomIdentifier}-remark-${index}`;
                                return (
                                  <article key={key} className={`remark-card ${meta.variant}`}>
                                    <b className={`remark-chip ${meta.variant}`}>
                                      <span className="material-symbols-rounded" aria-hidden="true">
                                        {meta.icon}
                                      </span>
                                      {meta.label}
                                    </b>
                                    {remark.text ? (
                                      <div
                                        className="remark-text"
                                        dangerouslySetInnerHTML={{ __html: decodeHtmlEntities(remark.text) }}
                                      />
                                    ) : (
                                      <p className="policy-summary">Additional information</p>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="booking-room-price">
                        Room price: {formatPrice(room.price.net ?? room.price.gross, bookingCurrency) ?? "Contact"}
                      </div>
                    </fieldset>
                  ))}
                  <div className="booking-summary">
                    <span>Total</span>
                    <strong>{formatPrice(bookingTotal, bookingCurrency) ?? "Contact"}</strong>
                  </div>
                  <p className="booking-note">
                    You will be redirected to Idram to complete the payment.
                  </p>
                  <div className="booking-actions">
                    <button
                      type="button"
                      className="booking-secondary"
                      onClick={handleCloseBooking}
                      disabled={bookingLoading}
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      className="booking-primary"
                      onClick={handleBook}
                      disabled={bookingLoading}
                    >
                      {bookingLoading ? "Redirecting to Idram..." : "Pay with Idram"}
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                className="close"
                onClick={handleCloseBooking}
                aria-label="Close booking"
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
          )}

          {hotelCoordinates && mapEmbedSrc && (
            <div id={mapPopoverId} popover="auto" className="popover">
              <h2>Hotel location</h2>
              <iframe
                title="Hotel map location"
                src={mapEmbedSrc}
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                aria-label="Hotel location map"
              />
              <button
                type="button"
                className="close"
                popoverTarget={mapPopoverId}
                popoverTargetAction="hide"
                aria-label="Close map"
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
          )}
      </main>
  );
}
