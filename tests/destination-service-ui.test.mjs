import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const mocks = {
  "next/image": 'import React from "react"; export default function Image({unoptimized,priority,fill,...props}) { return React.createElement("img",props); }',
  "next/link": 'import React from "react"; export default function Link(props) { return React.createElement("a",props); }',
  "@/components/language-provider": 'export const useLanguage=()=>({locale:"en",t:{packageBuilder:{warningSelectHotel:"Please select a hotel",services:{hotel:"Hotel"},addTag:"Add",selectedTag:"Selected",toggleInProgress:"Loading"}}});',
  "@/components/currency-provider": 'export const useCurrency=()=>({currency:"AMD"});',
  "@/lib/use-amd-rates": 'export const useAmdRates=()=>({rates:null});',
  "@/lib/package-builder-state": 'export const openPackageBuilder=()=>{}; export const updatePackageBuilderState=()=>{};',
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return {url:"service-ui-test:"+specifier,shortCircuit:true};
    if (specifier.startsWith("@/")) {
      const base=root+specifier.slice(2);
      return next(pathToFileURL(base+(existsSync(base+".ts")?".ts":".tsx")).href,context);
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href) && !context.parentURL.includes("/node_modules/")) {
      for (const ext of [".ts",".tsx"]) {
        const target=new URL(specifier+ext,context.parentURL);
        if (existsSync(fileURLToPath(target))) return next(target.href,context);
      }
    }
    return next(specifier,context.parentURL?.startsWith("service-ui-test:")?{...context,parentURL:import.meta.url}:context);
  },
  load(url,context,next) {
    if (url.startsWith("service-ui-test:")) return {format:"module",shortCircuit:true,source:mocks[url.slice("service-ui-test:".length)]};
    if (url.startsWith(pathToFileURL(root).href) && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) return {
      format:"module",shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    };
    return next(url,context);
  },
});
const {filterServiceOffers,serviceOfferCategory,serviceDate,serviceTime,serviceCondition,isWizzAirOffer}=await import("../lib/packages/service-presentation.ts");
const {default:DestinationServiceOptions,DestinationOfferCard}=await import("../components/destinations/destination-service-options.tsx");
const {destinationServiceCopy}=await import("../components/destinations/destination-service-copy.ts");
const offer=(service,title,description="")=>({id:"quote-"+title,service,destinationId:"cyprus",hotelOfferId:"hotel-quote",contextKey:"trip",title,price:{amount:120,currency:"EUR"},expiresAt:"2027-01-01",journeys:[{from:"LCA",to:"Example Hotel",departure:"2026-11-15T12:00",description}],conditions:[]});

test("transfer categories use known vehicle labels and keep unknown vehicles visible in All",()=>{
  const car=offer("transfer","Standard car"),bus=offer("transfer","Minibus"),unknown=offer("transfer","Airport transfer");
  assert.equal(serviceOfferCategory(car),"car"); assert.equal(serviceOfferCategory(bus),"bus"); assert.equal(serviceOfferCategory(unknown),"all");
  assert.deepEqual(filterServiceOffers([car,bus,unknown],"all",""),[car,bus,unknown]);
  assert.deepEqual(filterServiceOffers([car,bus,unknown],"car",""),[car]);
});
test("experience filters and text search preserve the complete quoted party price",()=>{
  const sea=offer("attraction","Blue Lagoon cruise","Morning sailing"),tour=offer("attraction","Troodos village tour"),other=offer("attraction","Water park");
  const original=structuredClone([sea,tour,other]);
  assert.deepEqual(filterServiceOffers([sea,tour,other],"sea","MORNING"),[sea]);
  assert.deepEqual(filterServiceOffers([sea,tour,other],"sightseeing","troodos"),[tour]);
  assert.deepEqual(filterServiceOffers([sea,tour,other],"all","water"),[other]);
  assert.deepEqual([sea,tour,other],original);
});
test("journey times stay airport-local and cancellation timestamps become labeled calendar dates",()=>{
  assert.equal(serviceDate("2026-11-15T00:00:00+14:00","en-GB"),"15 Nov 2026");
  assert.equal(serviceTime("2026-11-15T12:15:00+02:00"),"12:15");
  assert.equal(serviceTime("2026-11-15T12:15:00.000Z"),"12:15");
  assert.equal(serviceTime("2026-11-15"),null);
  assert.equal(serviceCondition("2026-11-14T23:59:00: 50 EUR","en-GB","Cancellation fee from"),"Cancellation fee from 14 Nov 2026 · 50 EUR");
});
test("Wizz branding requires every displayed flight segment to identify the airline",()=>{
  const flight=offer("flight","EVN ↔ LCA","W6 4567");
  assert.equal(isWizzAirOffer(flight),true);
  assert.equal(isWizzAirOffer({...flight,journeys:[{...flight.journeys[0],description:"W6 4567 · BA 10"}]}),false);
  assert.equal(isWizzAirOffer({...flight,journeys:[{...flight.journeys[0],description:""}]}),false);
});
const cardProps={selected:false,busy:false,guestCount:3,locale:"en-GB",c:destinationServiceCopy.en,format:(amount,currency)=>amount+" "+currency,onSelect:async()=>{},addLabel:"Add",selectedLabel:"Selected"};
test("all service cards label totals for the whole party without guessing baggage or per-person prices",()=>{
  for (const service of ["transfer","flight","attraction"]) {
    const html=renderToStaticMarkup(React.createElement(DestinationOfferCard,{...cardProps,offer:offer(service,"Example option")}));
    assert.match(html,/Total for 3 guests/); assert.match(html,/120 EUR/); assert.doesNotMatch(html,/per person|baggage included|checked bag|priority boarding/i);
    assert.match(html,/role="listitem"/);
  }
});
test("service pages remain hotel-bound and selected options remain visibly selected",()=>{
  for (const service of ["transfer","flight","attraction"]) {
    const html=renderToStaticMarkup(React.createElement(DestinationServiceOptions,{service,state:{}}));
    assert.match(html,/Please select a hotel/); assert.doesNotMatch(html,/Find options|<form/);
    const card=renderToStaticMarkup(React.createElement(DestinationOfferCard,{...cardProps,offer:offer(service,"Chosen"),selected:true}));
    assert.match(card,/is-selected/); assert.match(card,/disabled=""/);
  }
});
