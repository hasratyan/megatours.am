import AdminB2bBookingsClient from "./admin-b2b-bookings-client";
import ProfileSignIn from "@/components/profile-signin";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getB2bDb } from "@/lib/db";
import { hasAdminConfig, isAdminUser } from "@/lib/admin";
import { buildLocalizedMetadata } from "@/lib/metadata";
import { defaultLocale, getTranslations, Locale, locales } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ locale: string }>;
};

type B2bServiceStatus = "skipped" | "booked" | "failed";
type B2bReviewStatus = "new" | "in_progress" | "needs_followup" | "resolved";

type B2bServiceResult = {
  status?: B2bServiceStatus | string | null;
  referenceId?: string | null;
  message?: string | null;
  items?: number | null;
  provider?: string | null;
  policies?: unknown[] | null;
} | null;

type B2bServiceBookingDocument = {
  _id?: unknown;
  createdAt?: Date | string | null;
  requestId?: string | null;
  clientId?: string | null;
  customerRefNumber?: string | null;
  hotelCode?: string | null;
  destinationCode?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  bookingResult?: unknown;
  servicesPayload?: unknown;
  servicesResult?: {
    transfer?: B2bServiceResult;
    excursions?: B2bServiceResult;
    insurance?: B2bServiceResult;
  } | null;
  review?: {
    status?: B2bReviewStatus | string | null;
    note?: string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  } | null;
};

type AdminB2bServiceBookingRecord = {
  id: string;
  createdAt: string | null;
  requestId: string | null;
  clientId: string | null;
  customerRefNumber: string | null;
  hotelCode: string | null;
  destinationCode: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  bookingResult: unknown;
  servicesPayload: unknown;
  servicesResult: {
    transfer: B2bServiceResult;
    excursions: B2bServiceResult;
    insurance: B2bServiceResult;
  };
  review: {
    status: B2bReviewStatus;
    note: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  };
};

const reviewStatuses: readonly B2bReviewStatus[] = [
  "new",
  "in_progress",
  "needs_followup",
  "resolved",
];

const resolveLocale = (value: string | undefined) =>
  locales.includes(value as Locale) ? (value as Locale) : defaultLocale;

const serializeDate = (value?: Date | string | null) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const normalizeReviewStatus = (value: unknown): B2bReviewStatus => {
  if (typeof value !== "string") return "new";
  const normalized = value.trim().toLowerCase();
  return reviewStatuses.includes(normalized as B2bReviewStatus)
    ? (normalized as B2bReviewStatus)
    : "new";
};

const sanitizeForClient = (value: unknown): unknown => {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_, current) => {
      if (current instanceof Date) return current.toISOString();
      if (
        current &&
        typeof current === "object" &&
        typeof (current as { toHexString?: () => string }).toHexString === "function"
      ) {
        return (current as { toHexString: () => string }).toHexString();
      }
      return current;
    })
  );
};

const sanitizeBookingResult = (value: unknown) => {
  const record = sanitizeForClient(value);
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const mutable = record as Record<string, unknown>;
  if (typeof mutable.sessionId === "string") {
    mutable.sessionId = "";
  }
  if (Array.isArray(mutable.rooms)) {
    mutable.rooms = mutable.rooms.map((room) => {
      if (!room || typeof room !== "object") return room;
      const mutableRoom = { ...(room as Record<string, unknown>) };
      if ("rateKey" in mutableRoom) {
        mutableRoom.rateKey = null;
      }
      return mutableRoom;
    });
  }
  return mutable;
};

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  return buildLocalizedMetadata({
    locale: resolvedLocale,
    title: t.admin.b2bBookings.title,
    description: t.admin.b2bBookings.subtitle,
    path: "/admin/b2b-bookings",
  });
}

export default async function AdminB2bBookingsPage({ params }: PageProps) {
  const { locale } = await params;
  const resolvedLocale = resolveLocale(locale);
  const t = getTranslations(resolvedLocale);
  const session = await getServerSession(authOptions);
  const userIdentity = {
    id: session?.user?.id ?? null,
    email: session?.user?.email ?? null,
  };

  if (!session?.user) {
    return (
      <main className="container admin-page">
        <ProfileSignIn
          title={t.admin.access.signInTitle}
          body={t.admin.access.signInBody}
          cta={t.admin.access.signInCta}
        />
      </main>
    );
  }

  if (!hasAdminConfig()) {
    return (
      <main className="container admin-page">
        <section className="profile-card admin-empty">
          <h1>{t.admin.access.configTitle}</h1>
          <p>{t.admin.access.configBody}</p>
        </section>
      </main>
    );
  }

  if (!isAdminUser(userIdentity)) {
    return (
      <main className="container admin-page">
        <section className="profile-card admin-empty">
          <h1>{t.admin.access.deniedTitle}</h1>
          <p>{t.admin.access.deniedBody}</p>
        </section>
      </main>
    );
  }

  const db = await getB2bDb();
  const serviceBookingDocs = (await db
    .collection("b2b_service_bookings")
    .find({})
    .sort({ createdAt: -1 })
    .limit(1000)
    .toArray()) as B2bServiceBookingDocument[];

  const bookings: AdminB2bServiceBookingRecord[] = serviceBookingDocs.map((entry) => {
    const id =
      entry._id && typeof (entry._id as { toString?: () => string }).toString === "function"
        ? (entry._id as { toString: () => string }).toString()
        : "";
    const review = entry.review ?? null;
    const servicesResult = entry.servicesResult ?? null;
    return {
      id,
      createdAt: serializeDate(entry.createdAt),
      requestId: typeof entry.requestId === "string" ? entry.requestId : null,
      clientId: typeof entry.clientId === "string" ? entry.clientId : null,
      customerRefNumber:
        typeof entry.customerRefNumber === "string" ? entry.customerRefNumber : null,
      hotelCode: typeof entry.hotelCode === "string" ? entry.hotelCode : null,
      destinationCode: typeof entry.destinationCode === "string" ? entry.destinationCode : null,
      checkInDate: typeof entry.checkInDate === "string" ? entry.checkInDate : null,
      checkOutDate: typeof entry.checkOutDate === "string" ? entry.checkOutDate : null,
      bookingResult: sanitizeBookingResult(entry.bookingResult),
      servicesPayload: sanitizeForClient(entry.servicesPayload),
      servicesResult: {
        transfer: servicesResult?.transfer ?? null,
        excursions: servicesResult?.excursions ?? null,
        insurance: servicesResult?.insurance ?? null,
      },
      review: {
        status: normalizeReviewStatus(review?.status),
        note: typeof review?.note === "string" ? review.note : null,
        updatedBy: typeof review?.updatedBy === "string" ? review.updatedBy : null,
        updatedAt: serializeDate(review?.updatedAt),
      },
    };
  });

  return (
    <main className="container admin-page">
      <AdminB2bBookingsClient
        adminUser={{
          name: session.user.name ?? null,
          email: session.user.email ?? null,
        }}
        initialBookings={bookings}
      />
    </main>
  );
}
