"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { useLanguage } from "@/components/language-provider";
import type { PluralForms } from "@/lib/i18n";

// Types - exported for use in search-form
export type MapLocationOption = {
  value: string;
  label: string;
  rawId?: string;
  type: "destination" | "hotel";
  parentDestinationId?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  imageUrl?: string;
  price?: string;
};

export type HotelMapPickerProps = {
  hotels: MapLocationOption[];
  selectedHotel: MapLocationOption | null;
  onSelectHotel: (hotel: MapLocationOption) => void;
  isOpen?: boolean;
};

const MARKER_SIZE_DEFAULT = 28;
const MARKER_SIZE_ACTIVE = 36;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttribute = (value: string): string =>
  escapeHtml(value).replace(/`/g, "&#96;");

const normalizeImageUrl = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  return null;
};

const normalizePriceLabel = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Custom marker icons - use a price label when available, otherwise use pin
const createMarkerIcon = (isSelected: boolean, priceLabel?: string | null) => {
  if (priceLabel) {
    return L.divIcon({
      className: `hotel-price-marker-wrapper${isSelected ? " highlighted" : ""}`,
      html: `<div class="hotel-price-marker">${escapeHtml(priceLabel)}</div>`,
      iconSize: [92, 46],
      iconAnchor: [46, 46],
      popupAnchor: [0, -42],
    });
  }

  const size = isSelected ? MARKER_SIZE_ACTIVE : MARKER_SIZE_DEFAULT;

  return L.divIcon({
    className: `hotel-marker ${isSelected ? "hotel-marker--selected" : ""}`,
    html: `
      <div class="hotel-marker__pin">
        <span class="material-symbols-rounded">hotel</span>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
};

// Generate star rating HTML
const generateStars = (rating: number) => {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  let starsHtml = "";
  
  for (let i = 0; i < fullStars; i++) {
    starsHtml += '<span class="material-symbols-rounded star-icon">star</span>';
  }
  if (hasHalfStar) {
    starsHtml += '<span class="material-symbols-rounded star-icon">star_half</span>';
  }
  
  return starsHtml;
};

export default function HotelMapPicker({
  hotels,
  selectedHotel,
  onSelectHotel,
  isOpen = true,
}: HotelMapPickerProps) {
  const { locale, t } = useLanguage();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerClusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const hotelsRef = useRef<Map<string, MapLocationOption>>(new Map());
  const previousSelectedRef = useRef<string | null>(null);
  const selectedHotelIdRef = useRef<string | null>(null);
  const pluralRules = useMemo(() => new Intl.PluralRules(locale), [locale]);
  const formatPlural = useCallback((count: number, forms: PluralForms) => {
    const category = pluralRules.select(count);
    const template = forms[category] ?? forms.other;
    return template.replace("{count}", count.toString());
  }, [pluralRules]);
  const selectedHotelId = selectedHotel?.value ?? null;
  selectedHotelIdRef.current = selectedHotelId;
  const mapUiCopy = useMemo(() => {
    if (locale === "hy") {
      return {
        fromLabel: "Գինը",
        selectHotelLabel: "Ընտրել հյուրանոցը",
        selectHint: "Պահեք մկնիկը նշիչի վրա, ապա ընտրեք հյուրանոցը",
      };
    }
    if (locale === "ru") {
      return {
        fromLabel: "Цена",
        selectHotelLabel: "Выбрать отель",
        selectHint: "Наведите на маркер, затем выберите отель",
      };
    }
    return {
      fromLabel: "From",
      selectHotelLabel: "Select hotel",
      selectHint: "Hover a marker, then select a hotel",
    };
  }, [locale]);
  const getHotelPriceLabel = useCallback(
    (hotel: MapLocationOption | null | undefined) => normalizePriceLabel(hotel?.price),
    []
  );
  const scheduleMapResizeSync = useCallback(() => {
    if (typeof window === "undefined") return () => {};

    const run = () => {
      mapInstanceRef.current?.invalidateSize(false);
    };

    run();
    const rafId = window.requestAnimationFrame(run);
    const shortTimeoutId = window.setTimeout(run, 120);
    const longTimeoutId = window.setTimeout(run, 420);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(shortTimeoutId);
      window.clearTimeout(longTimeoutId);
    };
  }, []);

  // Filter hotels with valid coordinates and ignore explicit zero ratings
  const validHotels = useMemo(() => {
    return hotels.filter((hotel) => {
      const lat = hotel.lat;
      const lng = hotel.lng;
      const rating = hotel.rating;
      const hasZeroRating =
        typeof rating === "number" && Number.isFinite(rating) && rating <= 0;
      return (
        typeof lat === "number" &&
        typeof lng === "number" &&
        lat !== 0 &&
        lng !== 0 &&
        !isNaN(lat) &&
        !isNaN(lng) &&
        !hasZeroRating
      );
    });
  }, [hotels]);

  // Build a lookup map for hotels
  useEffect(() => {
    hotelsRef.current.clear();
    validHotels.forEach((hotel) => {
      hotelsRef.current.set(hotel.value, hotel);
    });
  }, [validHotels]);

  // Stable callback for hotel selection
  const handleHotelSelect = useCallback((hotelId: string) => {
    const hotel = hotelsRef.current.get(hotelId);
    if (hotel) {
      onSelectHotel(hotel);
    }
  }, [onSelectHotel]);

  // Calculate map bounds from hotels
  const bounds = useMemo(() => {
    if (validHotels.length === 0) return null;
    
    const lats = validHotels.map((h) => h.lat!);
    const lngs = validHotels.map((h) => h.lng!);
    
    return L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
  }, [validHotels]);

  // Initialize map (only once)
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    if (validHotels.length === 0) return;

    // Default center (Dubai)
    const defaultCenter: L.LatLngExpression = [25.2048, 55.2708];
    
    const map = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 11,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    // Add tile layer (OpenStreetMap light theme)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Fit to bounds if we have hotels
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    const markerCluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      chunkedLoading: true,
      chunkInterval: 50,
      chunkDelay: 30,
      removeOutsideVisibleBounds: true,
    });

    markerCluster.addTo(map);
    markerClusterRef.current = markerCluster;

    mapInstanceRef.current = map;
    const cancelScheduledResize = scheduleMapResizeSync();

    return () => {
      cancelScheduledResize();
      markerCluster.clearLayers();
      markerCluster.remove();
      markerClusterRef.current = null;
      map.remove();
      mapInstanceRef.current = null;
      markersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validHotels.length > 0]);

  useEffect(() => {
    if (!isOpen) return;
    return scheduleMapResizeSync();
  }, [isOpen, scheduleMapResizeSync, validHotels.length]);

  useEffect(() => {
    const container = mapRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      mapInstanceRef.current?.invalidateSize(false);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Add markers (only when hotels change)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerCluster = markerClusterRef.current;
    if (!map || !markerCluster) return;

    // Clear existing markers
    markerCluster.clearLayers();
    markersRef.current.clear();

    // Add markers for each hotel
    const newMarkers: L.Marker[] = [];
    validHotels.forEach((hotel) => {
      const isSelected = selectedHotelIdRef.current === hotel.value;
      const priceLabel = getHotelPriceLabel(hotel);
      const safeHotelLabel = escapeHtml(hotel.label);
      const rating = typeof hotel.rating === "number" && Number.isFinite(hotel.rating) ? hotel.rating : 0;
      const resolvedImageUrl = normalizeImageUrl(hotel.imageUrl);

      const marker = L.marker([hotel.lat!, hotel.lng!], {
        icon: createMarkerIcon(isSelected, priceLabel),
        zIndexOffset: isSelected ? 1000 : 0,
      });

      const popupContent = `
        <div class="hotel-popup${resolvedImageUrl ? " hotel-popup--has-image" : ""}">
          ${
            resolvedImageUrl
              ? `<div class="hotel-popup__image"><img src="${escapeAttribute(resolvedImageUrl)}" alt="${escapeAttribute(hotel.label)}" loading="lazy" referrerpolicy="no-referrer" /></div>`
              : ""
          }
          <div class="hotel-popup__header">
            <p class="hotel-popup__name">${safeHotelLabel}</p>
            ${rating > 0 ? `<div class="hotel-popup__rating">${generateStars(rating)}<span class="hotel-popup__rating-text">${rating.toFixed(1)}</span></div>` : ""}
          </div>
          ${priceLabel ? `<div class="hotel-popup__price"><span>${escapeHtml(mapUiCopy.fromLabel)}</span><strong>${escapeHtml(priceLabel)}</strong></div>` : ""}
          <button type="button" class="hotel-popup__select" data-hotel-id="${escapeAttribute(hotel.value)}">
            ${escapeHtml(mapUiCopy.selectHotelLabel)}
          </button>
        </div>
      `;

      marker.bindPopup(popupContent, {
        className: "hotel-marker-popup",
        maxWidth: 260,
        minWidth: 220,
        closeButton: true,
        autoPan: true,
      });
      marker.on("mouseover", () => {
        marker.openPopup();
      });

      newMarkers.push(marker);
      markersRef.current.set(hotel.value, marker);
    });

    markerCluster.addLayers(newMarkers);

    // Handle popup button clicks (in case popup is clicked instead of marker)
    const handlePopupClick = (e: Event) => {
      const target = e.target as HTMLElement;
      const button = target.closest(".hotel-popup__select") as HTMLElement;
      if (button) {
        const hotelId = button.dataset.hotelId;
        if (hotelId) {
          handleHotelSelect(hotelId);
        }
      }
    };

    map.getContainer().addEventListener("click", handlePopupClick);

    return () => {
      map.getContainer().removeEventListener("click", handlePopupClick);
    };
  }, [validHotels, handleHotelSelect, getHotelPriceLabel, mapUiCopy.fromLabel, mapUiCopy.selectHotelLabel]);

  // Update only the changed markers when selection changes (lightweight update)
  useEffect(() => {
    const currentSelected = selectedHotelId;
    const previousSelected = previousSelectedRef.current;

    if (previousSelected && previousSelected !== currentSelected) {
      const prevMarker = markersRef.current.get(previousSelected);
      const previousHotel = hotelsRef.current.get(previousSelected);
      if (prevMarker) {
        prevMarker.setIcon(createMarkerIcon(false, getHotelPriceLabel(previousHotel)));
        prevMarker.setZIndexOffset(0);
      }
    }

    if (currentSelected) {
      const currentMarker = markersRef.current.get(currentSelected);
      const currentHotel = hotelsRef.current.get(currentSelected);
      if (currentMarker) {
        currentMarker.setIcon(createMarkerIcon(true, getHotelPriceLabel(currentHotel)));
        currentMarker.setZIndexOffset(1000);
      }
    }

    previousSelectedRef.current = currentSelected;
  }, [selectedHotelId, getHotelPriceLabel]);

  if (validHotels.length === 0) {
    return (
      <div className="hotel-map-picker hotel-map-picker--empty">
        <span className="material-symbols-rounded">location_off</span>
        <p>{t.search.mapEmpty}</p>
      </div>
    );
  }

  return (
    <div className="hotel-map-picker">
      <div className="hotel-map-picker__info">
        <span className="material-symbols-rounded">touch_app</span>
        <span>
          {formatPlural(validHotels.length, t.search.mapHotelsCount)} — {mapUiCopy.selectHint}
        </span>
      </div>
      <div className="hotel-map-picker__map" ref={mapRef} />
    </div>
  );
}
