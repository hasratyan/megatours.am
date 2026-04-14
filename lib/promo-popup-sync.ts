export const PROMO_POPUP_CONFIG_UPDATE_EVENT = "promo-popup-config-updated";

export const notifyPromoPopupConfigUpdated = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROMO_POPUP_CONFIG_UPDATE_EVENT));
};
