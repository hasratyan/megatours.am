import assert from "node:assert/strict";
import test from "node:test";
import { getHotelGalleryImages, getHotelPrefetchSummary } from "../lib/hotel-presentation.ts";

test("prefetch retains hotel identity and primary media without transferring secondary content", () => {
  const hotel = {
    name: "Example Hotel", systemId: "123", destinationId: "160-0", rating: 5,
    imageUrl: "https://example.com/hero.jpg", imageUrls: ["first.jpg", "second.jpg"],
    masterHotelAmenities: ["Pool", "Wi-Fi"], geoCode: { lat: 25, lon: 55 },
  };
  const summary = getHotelPrefetchSummary(hotel);
  assert.deepEqual(summary.imageUrls, ["first.jpg"]);
  assert.equal(summary.masterHotelAmenities, null);
  assert.equal(summary.name, hotel.name);
  assert.equal(summary.imageUrl, hotel.imageUrl);
  assert.equal(summary.geoCode, hotel.geoCode);
  assert.deepEqual(hotel.imageUrls, ["first.jpg", "second.jpg"]);
  assert.deepEqual(hotel.masterHotelAmenities, ["Pool", "Wi-Fi"]);
});

test("hotels without gallery media remain valid summaries", () => {
  assert.deepEqual(getHotelPrefetchSummary({ imageUrls: [], masterHotelAmenities: null }), {
    imageUrls: [], masterHotelAmenities: null,
  });
});

test("a blank supplier image cannot displace the first usable summary image", () => {
  assert.deepEqual(getHotelPrefetchSummary({ imageUrls: [" ", "hero.jpg", "other.jpg"] }).imageUrls, ["hero.jpg"]);
});

test("gallery keeps full-size duplicates in original supplier order", () => {
  assert.deepEqual(getHotelGalleryImages([
    "https://example.com/thumbnail/one.jpg?size=100",
    "https://example.com/full/two.jpg",
    "https://example.com/full/one.jpg",
    "https://example.com/thumbnail/two.jpg",
  ]), ["https://example.com/full/one.jpg", "https://example.com/full/two.jpg"]);
});

test("gallery trims blanks and handles relative URLs and encoded paths", () => {
  assert.deepEqual(getHotelGalleryImages([
    " ", " /thumbnail/my%20hotel.jpg?small=1 ", "/full/my%20hotel.jpg",
    "https://example.com/thumbnail/photo%20one.jpg",
    "https://example.com/full/photo%20one.jpg",
  ]), ["/full/my%20hotel.jpg", "https://example.com/full/photo%20one.jpg"]);
});
