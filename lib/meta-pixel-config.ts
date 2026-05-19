export const defaultMetaPixelId = "1249492990325844";
export const defaultMetaViewContentType = "hotel";

export const resolveMetaPixelId = (value?: string) => {
  const trimmedValue = value?.trim();
  return trimmedValue && /^\d+$/.test(trimmedValue) ? trimmedValue : defaultMetaPixelId;
};

export const resolveMetaViewContentType = (value?: string) => {
  const trimmedValue = value?.trim();
  return trimmedValue && /^[a-zA-Z0-9_-]+$/.test(trimmedValue)
    ? trimmedValue
    : defaultMetaViewContentType;
};

export const metaPixelId = resolveMetaPixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID);

export const metaViewContentType = resolveMetaViewContentType(
  process.env.NEXT_PUBLIC_META_VIEW_CONTENT_TYPE
);
