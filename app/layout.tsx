import type { Metadata, Viewport } from "next";
import * as React from "react";
import Script from "next/script";
import { GoogleTagManager } from "@next/third-parties/google";
import { Google_Sans } from "next/font/google";
import "material-symbols/outlined.css";
import "material-symbols/rounded.css";
import MetaPixel from "@/components/meta-pixel";
import Providers from "@/components/providers";
import { metadataBase } from "@/lib/metadata";
import { resolveZohoSalesIqScriptUrl } from "@/lib/zoho-salesiq";
import "./globals.css";

const body = Google_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["sans-serif"],
});

export const metadata: Metadata = {
  metadataBase,
  openGraph: {
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const zohoSalesIqScriptUrl = resolveZohoSalesIqScriptUrl(
  process.env.NEXT_PUBLIC_ZOHO_SALESIQ_SCRIPT_URL
);

const defaultMetaPixelId = "1249492990325844";

const resolveMetaPixelId = (value?: string) => {
  const trimmedValue = value?.trim();
  return trimmedValue && /^\d+$/.test(trimmedValue) ? trimmedValue : defaultMetaPixelId;
};

const metaPixelId = resolveMetaPixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID);

const zohoSalesIqHandoffOnlyScript = `
(function(){
  var maxAttempts=50;
  var retryDelay=200;

  function hideDefaultLauncher(){
    if(
      window.__MEGATOURS_ZOHO_LIVE_AGENT_REQUESTED||
      document.documentElement.classList.contains("zoho-salesiq-live-agent-requested")
    ){return true;}
    var salesiq=window.$zoho&&window.$zoho.salesiq;
    var handled=false;

    ["[data-id='zsalesiq']","#zsiq_chat_wrap","#zsiq_float"].forEach(function(selector){
      var node=document.querySelector(selector);
      if(!node){return;}
      node.setAttribute("aria-hidden","true");
      node.style.setProperty("display","none","important");
      node.style.setProperty("visibility","hidden","important");
      node.style.setProperty("pointer-events","none","important");
      handled=true;
    });

    if(!salesiq){return handled;}

    try{if(salesiq.floatbutton&&typeof salesiq.floatbutton.visible==="function"){salesiq.floatbutton.visible("hide");handled=true;}}catch(error){}
    try{if(salesiq.floatwindow&&typeof salesiq.floatwindow.visible==="function"){salesiq.floatwindow.visible("hide");handled=true;}}catch(error){}
    try{if(salesiq.chatwindow&&typeof salesiq.chatwindow.visible==="function"){salesiq.chatwindow.visible("hide");handled=true;}}catch(error){}
    try{if(salesiq.chat&&salesiq.chat.window&&typeof salesiq.chat.window.visible==="function"){salesiq.chat.window.visible("hide");handled=true;}}catch(error){}

    return handled;
  }

  function poll(attempt){
    hideDefaultLauncher();
    if(window.__MEGATOURS_ZOHO_LIVE_AGENT_REQUESTED||attempt>=maxAttempts){return;}
    window.setTimeout(function(){poll(attempt+1);},retryDelay);
  }

  poll(0);
})();
`;

export default function RootLayout({ children }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <body className={`${body.variable} antialiased`}>
        <GoogleTagManager gtmId="GTM-MQJD3BQN" />
        <React.Suspense fallback={null}>
          <MetaPixel pixelId={metaPixelId} />
        </React.Suspense>
        {zohoSalesIqScriptUrl ? (
          <>
            <Script id="zoho-salesiq-bootstrap" strategy="beforeInteractive">
              {`window.__MEGATOURS_ZOHO_LIVE_AGENT_REQUESTED=false;document.documentElement.classList.add("zoho-salesiq-handoff-only");window.$zoho=window.$zoho||{};window.$zoho.salesiq=window.$zoho.salesiq||{ready:function(){}};`}
            </Script>
            <Script
              id="zoho-salesiq-widget"
              src={zohoSalesIqScriptUrl}
              strategy="afterInteractive"
            />
            <Script id="zoho-salesiq-handoff-only" strategy="afterInteractive">
              {zohoSalesIqHandoffOnlyScript}
            </Script>
          </>
        ) : null}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
