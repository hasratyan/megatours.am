const CURRENT_ZOHO_SALESIQ_WIDGET_CODE =
  "siq657d85d750568ce61ba86101c97b51d0aef0d66250c369dfc4432295129ed78a";

export const DEFAULT_ZOHO_SALESIQ_SCRIPT_URL =
  `https://salesiq.zohopublic.com/widget?wc=${CURRENT_ZOHO_SALESIQ_WIDGET_CODE}`;

export const resolveZohoSalesIqScriptUrl = (configuredUrl?: string | null) => {
  const trimmedUrl = typeof configuredUrl === "string" ? configuredUrl.trim() : "";

  if (!trimmedUrl || trimmedUrl.includes("your-widget-code")) {
    return DEFAULT_ZOHO_SALESIQ_SCRIPT_URL;
  }

  return trimmedUrl;
};
