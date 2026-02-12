import { ObjectId } from "mongodb";
import { normalizeParentDestinationId } from "@/lib/aoryx-client";
import { getB2bDb } from "@/lib/db";
import type { AoryxHotelInfoResult } from "@/types/aoryx";

type HotelDoc = Record<string, unknown> & { _id?: string | number | ObjectId };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof ObjectId) return value.toHexString();
  return null;
};

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readString = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = toStringValue(record[key]);
    if (value) return value;
  }
  return null;
};

const readNumber = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = toNumberValue(record[key]);
    if (value !== null) return value;
  }
  return null;
};

const normalizeAmenityList = (value: unknown): string[] => {
  if (!value) return [];

  const output: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    output.push(trimmed);
  };

  const extractLabel = (item: unknown): string | null => {
    if (typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return String(item);
    if (isRecord(item)) {
      return (
        toStringValue(
          item.Name ??
            item.Amenity ??
            item.AmenityName ??
            item.Text ??
            item.Value ??
            item.Description
        ) ?? null
      );
    }
    return null;
  };

  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const direct = extractLabel(node);
    if (direct) {
      add(direct);
      return;
    }
    if (isRecord(node)) {
      if (node.MasterHotelAmenities !== undefined) {
        visit(node.MasterHotelAmenities);
        return;
      }
      Object.values(node).forEach(visit);
    }
  };

  visit(value);
  return output;
};

const normalizeImageUrlList = (value: unknown): string[] => {
  const output: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null) => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    output.push(trimmed);
  };

  const visit = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      if (node.includes(",") && node.includes("http")) {
        node
          .split(",")
          .map((entry) => entry.trim())
          .forEach((entry) => add(entry));
      } else {
        add(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (isRecord(node)) {
      const direct =
        toStringValue(
          node.ImageUrl ??
            node.imageUrl ??
            node.Url ??
            node.url ??
            node.Image ??
            node.image ??
            node.Src ??
            node.src
        ) ?? null;
      if (direct) add(direct);
      Object.values(node).forEach(visit);
    }
  };

  visit(value);
  return output;
};

const normalizeDestinationId = (raw: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "0" || trimmed === "0-0") return null;
  return normalizeParentDestinationId(trimmed);
};

const valueOrNull = <T extends Record<string, unknown>>(value: T): T | null =>
  Object.values(value).some((entry) => entry !== null) ? value : null;

const buildAddress = (
  doc: HotelDoc,
  rawAddress: Record<string, unknown> | null
): AoryxHotelInfoResult["address"] => {
  const address = {
    line1:
      (rawAddress
        ? readString(rawAddress, [
            "Line1",
            "line1",
            "Address1",
            "address1",
            "Add1",
            "add1",
            "AddressLine1",
            "addressLine1",
            "address_line1",
          ])
        : null) ??
      readString(doc, [
        "Address1",
        "address1",
        "Add1",
        "add1",
        "line1",
        "Line1",
        "AddressLine1",
        "addressLine1",
        "address_line1",
      ]),
    line2:
      (rawAddress
        ? readString(rawAddress, [
            "Line2",
            "line2",
            "Address2",
            "address2",
            "Add2",
            "add2",
            "AddressLine2",
            "addressLine2",
            "address_line2",
          ])
        : null) ??
      readString(doc, [
        "Address2",
        "address2",
        "Add2",
        "add2",
        "line2",
        "Line2",
        "AddressLine2",
        "addressLine2",
        "address_line2",
      ]),
    countryCode:
      (rawAddress ? readString(rawAddress, ["CountryCode", "countryCode"]) : null) ??
      readString(doc, ["CountryCode", "countryCode"]),
    countryName:
      (rawAddress ? readString(rawAddress, ["CountryName", "countryName"]) : null) ??
      readString(doc, ["CountryName", "countryName"]),
    cityName:
      (rawAddress ? readString(rawAddress, ["CityName", "cityName", "City", "city"]) : null) ??
      readString(doc, ["CityName", "cityName", "City", "city", "DestinationName", "destinationName"]),
    stateCode:
      (rawAddress ? readString(rawAddress, ["StateCode", "stateCode"]) : null) ??
      readString(doc, ["StateCode", "stateCode"]),
    zipCode:
      (rawAddress ? readString(rawAddress, ["ZipCode", "zipCode", "PostalCode", "postalCode"]) : null) ??
      readString(doc, ["ZipCode", "zipCode", "PostalCode", "postalCode"]),
  };
  return valueOrNull(address);
};

const buildGeoCode = (
  doc: HotelDoc,
  rawGeoCode: Record<string, unknown> | null
): AoryxHotelInfoResult["geoCode"] => {
  const geoCode = {
    lat:
      (rawGeoCode ? readNumber(rawGeoCode, ["Lat", "lat", "Latitude", "latitude"]) : null) ??
      readNumber(doc, ["Lat", "lat", "Latitude", "latitude"]),
    lon:
      (rawGeoCode ? readNumber(rawGeoCode, ["Lon", "lon", "Longitude", "longitude"]) : null) ??
      readNumber(doc, ["Lon", "lon", "Longitude", "longitude"]),
  };
  return valueOrNull(geoCode);
};

const buildContact = (
  doc: HotelDoc,
  rawContact: Record<string, unknown> | null
): AoryxHotelInfoResult["contact"] => {
  const contact = {
    phone:
      (rawContact ? readString(rawContact, ["PhoneNo", "phoneNo", "Phone", "phone"]) : null) ??
      readString(doc, ["PhoneNo", "phoneNo", "Phone", "phone"]),
    fax:
      (rawContact ? readString(rawContact, ["FaxNo", "faxNo", "Fax", "fax"]) : null) ??
      readString(doc, ["FaxNo", "faxNo", "Fax", "fax"]),
    website:
      (rawContact ? readString(rawContact, ["Website", "website", "Url", "url"]) : null) ??
      readString(doc, ["Website", "website", "Url", "url"]),
  };
  return valueOrNull(contact);
};

export async function getHotelInfoFromDb(hotelCode: string): Promise<AoryxHotelInfoResult | null> {
  const trimmedHotelCode = hotelCode.trim();
  if (!trimmedHotelCode) return null;

  const db = await getB2bDb();
  const numericCode = Number(trimmedHotelCode);
  const searchValues: Array<string | number> = [trimmedHotelCode];
  if (Number.isFinite(numericCode)) {
    searchValues.push(numericCode);
  }
  const idSearchValues: Array<string | number | ObjectId> = [...searchValues];
  if (ObjectId.isValid(trimmedHotelCode)) {
    idSearchValues.push(new ObjectId(trimmedHotelCode));
  }

  const doc = await db.collection<HotelDoc>("aoryx_hotels").findOne({
    $or: [
      { systemId: { $in: searchValues } },
      { SystemId: { $in: searchValues } },
      { hotelCode: { $in: searchValues } },
      { HotelCode: { $in: searchValues } },
      { code: { $in: searchValues } },
      { Code: { $in: searchValues } },
      { id: { $in: searchValues } },
      { Id: { $in: searchValues } },
      { _id: { $in: idSearchValues } },
    ],
  });

  if (!doc) return null;

  const rawAddress = isRecord(doc.Address) ? doc.Address : isRecord(doc.address) ? doc.address : null;
  const rawGeoCode = isRecord(doc.GeoCode) ? doc.GeoCode : isRecord(doc.geoCode) ? doc.geoCode : null;
  const rawContact = isRecord(doc.Contact) ? doc.Contact : isRecord(doc.contact) ? doc.contact : null;

  const mainImage =
    readString(doc, ["ImageUrl", "imageUrl", "Image", "image", "PrimaryImage", "primaryImage"]) ?? null;
  const imageUrls = normalizeImageUrlList([
    doc.ImageUrls,
    doc.imageUrls,
    doc.Images,
    doc.images,
    doc.Gallery,
    doc.gallery,
    mainImage,
  ]);
  const imageUrl = imageUrls[0] ?? mainImage;

  const rawDestinationId =
    readString(doc, [
      "GiDestinationId",
      "GIDestinationId",
      "GiDestinationID",
      "DestinationId",
      "DestinationID",
      "destinationId",
      "destinationCode",
      "DestinationCode",
      "CityCode",
      "cityCode",
    ]) ??
    (rawAddress ? readString(rawAddress, ["CityCode", "cityCode", "CityId", "cityId", "CityID"]) : null);
  const destinationName =
    readString(doc, ["DestinationName", "destinationName"]) ??
    (rawAddress ? readString(rawAddress, ["CityName", "cityName", "City", "city"]) : null) ??
    readString(doc, ["CityName", "cityName", "City", "city"]);

  const masterHotelAmenities = normalizeAmenityList(
    doc.MasterHotelAmenities ??
      doc.masterHotelAmenities ??
      doc.HotelAmenities ??
      doc.hotelAmenities ??
      doc.Amenities ??
      doc.amenities
  );

  return {
    destinationId: normalizeDestinationId(rawDestinationId),
    destinationName,
    systemId: readString(doc, ["SystemId", "systemId", "HotelCode", "hotelCode", "Code", "code", "Id", "id", "_id"]),
    name: readString(doc, ["Name", "name", "HotelName", "hotelName"]),
    rating: readNumber(doc, ["Rating", "rating", "StarRating", "starRating"]),
    tripAdvisorRating: readNumber(doc, ["TripAdvisorRating", "tripAdvisorRating"]),
    tripAdvisorUrl: readString(doc, ["TripAdvisorUrl", "tripAdvisorUrl"]),
    currencyCode: readString(doc, ["CurrencyCode", "currencyCode", "Currency", "currency"]),
    imageUrl,
    imageUrls,
    masterHotelAmenities: masterHotelAmenities.length > 0 ? masterHotelAmenities : null,
    address: buildAddress(doc, rawAddress),
    geoCode: buildGeoCode(doc, rawGeoCode),
    contact: buildContact(doc, rawContact),
  };
}
