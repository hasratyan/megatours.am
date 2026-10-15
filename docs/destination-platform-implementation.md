# Destination platform implementation

15 October 2026. Local implementation; not deployed.

UAE and Cyprus render the same existing `Home`, `SearchForm`, `ResultsClient`, `HotelClient` and `.package-builder__panel`. The locale root remains the UAE homepage. A flag/name switcher sits immediately above the homepage hero title; there is no header destination select or separate Cyprus design. Country context changes localized copy, featured hotels, catalogue, hero media and service adapters. Search and hotel URLs remain shared, using `destinationId`/`countryCode` query parameters. Existing UAE city pages and booking URLs remain supported.

Cyprus browses the agent database catalogue and searches its hotel integrations. Room selection forces a fresh price check, then allows a hotel-only review or any combination of hotel-bound transfer, flight and optional services. These services cannot be quoted independently of a validated hotel package. The server persists encrypted, owner-bound hotel/service quotes and package reviews. Supplier booking, ticket issuance, and payment dispatch remain to be implemented. No Cyprus payment button is enabled.

The approved commercial policy is **12% hotel markup and 0% transfer/flight markup**. Services retain their supplier price and can only be included with a hotel. Zero markup does not make the service price zero.

Flight tickets are paid separately through Kyte. The shared trip still allows all service combinations, but flight prices are excluded from the MEGATOURS checkout subtotal and coupon base. The package panel, flight options and checkout explain the separate payment. The checkout summary keeps the flight quote in its own section. Gateway reviews now persist an encrypted version-2 snapshot with distinct MEGATOURS and Kyte payment groups; public `totals` means the MEGATOURS group only. Review IDs are versioned so an earlier combined-payment review cannot be reused. Insurance continues through the existing EFES quote path and is added by the shared checkout, rather than the agent hotel/service review.

## Catalogue connection

Set these server environment values through the normal deployment configuration:

| Application | Variable | Purpose |
| --- | --- | --- |
| Agent | `B2C_CATALOG_TOKEN` | A random token of at least 32 characters, scoped to the catalogue endpoint |
| B2C | `B2C_AGENT_URL` | HTTPS origin of the agent application |
| B2C | `B2C_AGENT_TOKEN` | The matching catalogue token |

Never use `NEXT_PUBLIC_` for these credentials. Missing credentials return a controlled unavailable state. Plain HTTP is accepted only for a loopback development origin. The B2C server refuses redirects when sending its token.

Agent `/api/b2c/v1/catalog` authenticates its service token and restricts reads to Cyprus. It uses the existing city and city-hotel resolvers, active published catalogue models, and stored hotel content. When materialized content is absent, it builds a safe preview from stored supplier records in bulk; this never calls live supplier APIs. Public data contains canonical hotel IDs, names, locations, ratings, safe image URLs, and addresses. Supplier codes, costs, sessions, and credentials remain server-side.

The agent proxy exception is an exact allowlist of the B2C catalogue, hotel search/prebook, service search/prebook, and package review routes. Each route performs its own scoped authentication. Catalogue credentials cannot authorize service operations.

## Availability and package services

| Application | Variable | Purpose |
| --- | --- | --- |
| Agent | `B2C_SERVICES_TOKEN` | Separate random server credential of at least 32 characters |
| Agent | `B2C_CHANNEL_CONFIG_JSON` | Explicit active channel, AM market, pricing version, and markups |
| Agent | `DATA_TOKEN_SECRET` | Existing sensitive-token encryption key; required for quote storage |
| B2C | `B2C_AGENT_SERVICES_TOKEN` | Matching server credential; never exposed to the browser |

The approved non-secret configuration is in agent `docs/b2c-cyprus-channel.example.json`. Its decimal markup values are `0.12` for hotels and `0` for extras. Do not replace existing agency pricing settings. The B2C identity owns its quotes/reviews separately from agency browser sessions.

Agent endpoints under `/api/b2c/v1`:

- `hotels/search`: canonical Cyprus city membership, complete room combinations, per-supplier availability with partial failures reported.
- `hotels/prebook`: current TBO/Hotelbeds/GoGlobal price and conditions, including a forced Hotelbeds CheckRate rather than an earlier BOOKABLE snapshot.
- `services/search`: only for a validated hotel + transfer/flight quote. Transfers include both airport legs, capacity checks, exact verified hotel mapping and transfer-specific child age bands. GIATA-only identities are resolved through the transfer catalogue and matched conservatively. Flight offers must include both journeys, all travelers, and dates compatible with the hotel stay.
- `services/prebook`: re-search/reprice transfers and fetch current flight details, retaining changed-price/terms flags.
- `attractions/search` and `attractions/prebook`: Cyprus country-scoped live activity availability/full details for the hotel dates and exact child ages. Public offers omit supplier rate keys; selected quotes are encrypted and bound to the hotel. Automatic defaults never call supplier preconfirmation or booking.
- `packages/review`: load trusted quotes, validate every selected service, and persist an idempotent encrypted review. Currency amounts remain separate until a payment exchange-rate snapshot is implemented. `paymentEnabled` is always false.

The B2C proxy derives quote ownership from a dedicated HttpOnly visitor cookie and allowlists submitted fields. It ignores browser-provided ownership, markup, supplier identifiers, market, and prices. Quotes expire within 15 minutes and are invalidated when the channel's pricing version or markup changes. Extra quotes are bound to the exact validated hotel offer, destination, party and travel context.

Local verification uses the agent database on localhost and a loopback quote-only server. Its credentials are private and excluded from Git. Production service configuration has not been changed.

## Booking foundation

`lib/packages/contracts.ts` defines neutral hotel offers, trip context, validated service quotes, and package drafts. `lib/packages/policy.ts` requires a validated hotel quote and a matching quote for every selected service, including transfer and flight together. Quote validation checks ownership, destination, travel context, currency, amount, and expiry. A package is complete only when each required service is confirmed.

Browser draft keys are scoped by destination while retaining legacy UAE storage keys and owner-specific drafts. Explicit country/destination mismatches are rejected. Legacy Aoryx booking parsing rejects Cyprus payloads so Cyprus cannot fall through to an Aoryx booking.

## Shared UI and defaults

- The existing package panel lets customers add/remove services freely. Hotel only, hotel + transfer, hotel + flight, hotel + transfer + flight, insurance and attractions are supported. There is no trip-type selector. Transfers and flights have separate quote slots, so adding/changing/removing one preserves the others. The hotel is required, and every selected extra must have a matching validated quote. Old single-extra drafts migrate without losing selections.
- On Cyprus hotel selection, the existing EFES Elite EUR 15,000 plan is preselected for the hotel dates and all guests, with Cyprus as travel country. Adult ages use the existing estimate of 30 until actual birth dates are supplied. Quotes remain editable in the existing insurance page and are repriced using actual traveler details before issuance.
- The first available Cyprus attraction is preselected from complete live rate details, with its operating day inside the stay. Customers can change/remove it. Empty inventory and supplier failures are distinct visible states; no placeholder attraction or price is added.
- `NEXT_PUBLIC_CYPRUS_HERO_VIDEO` can be set later; Cyprus currently uses its existing destination image. UAE keeps its current video.
- The same checkout component renders contact, room guest, transfer and insurance traveler forms for both countries. A Cyprus server-quote review is inserted into that form. Cyprus cannot enter Aoryx payment or development insurance-issuance handlers; Cyprus order/payment execution is still pending.

## Remaining work before Cyprus sales

- Implement passenger/contact details, durable package orders and provider-specific booking/ticketing execution with partial-failure reconciliation.
- Dispatch persisted Cyprus orders from VPOS/Idram/admin payment handlers while preserving older in-flight orders. Existing Aoryx handlers already reject explicitly labeled Cyprus payloads.
- Connect a separate, customer-authorized Kyte booking/payment flow, including card-fee repricing, verification challenges, status reconciliation and ticket confirmation. Never charge flights through VPOS/Idram/admin checkout or treat hotel payment as flight payment. No flight payment endpoint or redirect is exposed to B2C yet; the existing agent payment endpoint requires agency authentication and is not reused directly by customers.
- Apply package requirements to every payment and booking entry point and verify failure recovery end to end with sandbox suppliers and non-delivering email adapters.
- Configure production catalogue/services credentials and verified production supplier profiles, deploy compatible agent services first, then enable Cyprus payments after supplier/payment checks.

The internal B2C channel is an implementation identity for MEGATOURS. Customers do not need agent accounts. UAE currently calls Aoryx with the website's configured supplier credentials and saves bookings to the B2C `user_bookings` collection; it has no agent-site agency ownership. Cyprus customer orders can use the same B2C ownership pattern. Linking Cyprus supplier booking records into an existing agent agency is a separate accounting choice; the user selected an existing agency but has not named the record yet. Do not guess or borrow an agency session.

## Verification to date

- B2C production build and both repositories' TypeScript checks passed locally.
- Focused domain/API tests validate complete room/transfer/flight combinations, quote expiry, private supplier fields, owner/context isolation, selected-service enforcement and price-policy separation.
- A local MongoDB integration test proves encrypted quote storage, rejects another owner/channel/pricing policy, prevents standalone extra reviews, and verifies idempotent package review IDs and trusted totals.
- Browser checks returned real configured hotel availability and repriced hotel-only reviews. Hotel + transfer returned complete options after resolving the verified transfer catalogue hotel ID; current transfer pricing and package review passed, with 0% extra markup.
- The configured Cyprus Wizz Air flight search reached the supplier's sandbox endpoint but returned HTTP 403. The UI displays a safe unavailable state and keeps review disabled. Successful flight search/details/ticketing have not been verified.
- Destination switching is now in the homepage hero, with flags and localized names. Display-currency conversions are approximate and retain the original quote currency.

The local supplier configuration contains both test and production profiles. These checks are not production release evidence or proof of a completed reservation. No supplier booking, payment, or email delivery was initiated.

Transfer age bands and catalogue lookups follow the [Hotelbeds availability contract](https://developer.hotelbeds.com/documentation/transfers/booking-api/search-availability/availability-simple/) and [hotel catalogue contract](https://developer.hotelbeds.com/documentation/transfers/content-api/locations/hotels/).

### Shared UI verification, 15 October 2026

The shared homepage, Cyprus search results, hotel room options and existing package panel were exercised locally. Live hotel search and reprice succeeded; default insurance returned a current premium. The configured activities profile returned zero Cyprus activities for the checked October 2026 stay and June 2027 dates, so positive live attraction selection remains unverified (contract tests cover complete totals, operating dates and private rate keys). The local UI reports unavailable/empty offers explicitly. No paid reservation or email was initiated.

Final local checks: B2C production build generated 172 routes; both repositories passed TypeScript checks; 27 focused API/domain/local MongoDB tests passed. New destination modules and agent gateway files passed lint. Existing React lint errors in legacy shared components were compared with HEAD and did not increase. Browser checks covered the Armenian UAE/Cyprus switch, real Cyprus hotel search/reprice, default insurance, mandatory transfer checkout blocking, dependent-service removal and shared panel scrolling. The homepage had no horizontal overflow at 390px or 1440px after fixing the existing 101vw background width. The anonymous checkout still uses the existing sign-in gate; authenticated Cyprus checkout and supplier booking/payment execution remain unverified.

### Free combinations correction, 15 October 2026

Removed the fixed trip-type selector and package-switch step from service pages. Quote review takes selected transport services plus their separate opaque quote IDs; server validation rejects missing, duplicated, unrelated, expired or unselected service quotes. The local MongoDB integration test covers hotel + transfer + flight together, stable review IDs regardless of input order, trusted totals, removal of an extra and optional attractions. Legacy hotel rate-search scope is internal only; new searches default to standalone-sale hotel rates, and older package-only hotel quotes still require transport.

Current local validation: 32 focused tests passed across both repositories, including the MongoDB integration fixture for both transport services together; both TypeScript checks passed; the B2C production build generated 172 routes. Browser checks repriced a real hotel and opened both flight and transfer forms from the same draft without choosing a trip type. These do not prove a successful live flight quote or booking. Selected insurance must have a current price before package readiness; Cyprus service pages preserve its selection instead of silently removing it after a quote failure. Existing shared service-component lint errors match the HEAD baseline (25); the new selection helper passes lint.

Set `MEGATOURS_ISOLATED_PREVIEW=1` for a local dev preview to use `.next-preview` while another development server uses `.next`. This development-only flag does not change production output.

### Separate Kyte payment correction, 15 October 2026

Local verification passed: 16 B2C tests, 15 agent domain/catalogue tests and one local MongoDB integration test; both TypeScript checks and the B2C 172-route production build passed. The integration fixture proves EUR 112 hotel + EUR 100 transfer + EUR 500 flight produces EUR 212 in the website checkout and EUR 500 in the separate Kyte group. It covers flight-only extras, attraction totals, separate flight currencies, tampered client payment plans, encrypted payment-group persistence, idempotency and rejection of old combined-payment review identities. New/touched destination modules pass lint; legacy shared-component lint counts did not increase. The Armenian package panel displays the separate-payment notice in the browser. No B2C Kyte payment execution, supplier reservation, charge or email was initiated. This remains local and undeployed.
