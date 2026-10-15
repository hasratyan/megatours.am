# Performance changes

## September 2026

This pass reduces browser work and bounds stalled supplier responses. It uses the
existing Next.js 16 / React 19 installation; it does not upgrade dependencies.

| Area | Before | After |
| --- | --- | --- |
| Material Symbols, both font files | 9,355,368 bytes | 567,652 bytes (93.9% smaller) |
| Hotel result cards initially rendered | Entire result set | First 36, then Show more |
| Room options initially rendered | Entire filtered set | First 24, then Show more |
| Destination menu options initially rendered | Entire matching catalog | First 40, expanded by scrolling or keyboard navigation |
| AI assistant | Full component mounted while closed | Full component imported on first open |
| Public service flags | Separate layout widget requests | Shared pending request and 30-second in-memory cache |
| Aoryx request deadline | Stopped after response headers | Covers headers and complete response body |

Sorting and filtering still run against the entire result set. Changing the
filtered/sorted set resets the visible batch. The picker searches the full catalog
using `useDeferredValue`; loading another card batch uses `useTransition`. The new
list, picker, and deferred chat opt into the existing React Compiler annotation
configuration with `use memo`. The supplier helper uses `AbortSignal.timeout` and
`AbortSignal.any`, preserving the existing retry counts and booking retry policy.

### Icon font maintenance

The committed fonts retain the original variable axes, filled variants, and
license. Their CSS is generated from the installed Material Symbols package.
`npm run build` and `npm run dev` check the generated assets first and automatically
regenerate them when the installed `material-symbols` version changes, a source
icon is missing, or generated files are missing/corrupt. Valid fonts are reused;
ordinary builds do not invoke Python or install anything. The strict coverage and
checksum check still runs before Next.js builds and is available separately as
`npm run icons:check`.

Regeneration requires Python 3 with `venv` support. The first repair creates an
isolated environment in `node_modules/.cache/icon-fonts/venv` and installs the
pinned `scripts/icon-fonts-requirements.txt` using pip, which needs package-index
access on that first repair. Later repairs reuse the environment; `npm ci` removes
it with the rest of `node_modules`. Set `ICON_FONTS_PYTHON` when Python is installed
under a different executable path. No system Python packages are modified.

To repair fonts explicitly after adding icons or upgrading dependencies:

```sh
npm run icons:ensure
npm run icons:check
```

Commit the regenerated CSS, both fonts, manifest, and license in `assets/fonts/`.
The scanner collects literal tokens in application code, translations, and CSS;
it ignores comments, ordinary code identifiers, and module import/export paths. Keep icon names as complete
source literals. Icons assembled from string fragments or supplied exclusively
by remote content need an explicit source-literal mapping to be included. Unknown
names that do not exist in the installed font cannot be validated by this guard.

### Local verification

- Production build, TypeScript check, and focused lint on the new/shared files.
- 17 focused tests across booking flow, insurance checkout/pricing, and the new
  stalled-body deadline regression. The deadline test verifies connection release,
  a subsequent successful request, non-2xx body preservation, and caller abort.
- Browser fixture with 735 hotels, 584 room items, and 2,168 picker options:
  initial batches of 36 / 24 / 40; Show more; reset after sorting; full-set rating
  filtering (147 matching hotels); keyboard expansion; selecting the final picker
  item by search. The room fixture tests the shared list; live room selection and
  checkout still need an authenticated supplier-backed smoke test.
- Local production homepage in the first pass: the rounded font was 330,260 bytes; one shared service
  availability request; assistant panel opens after clicking its launcher.
- Touched legacy components retain their existing lint findings. This pass does
  not claim that repository-wide lint is clean.

The temporary fixture route is removed before the final build. Local supplier
search is unavailable without `AORYX_API_KEY`, so these checks do not establish a
live search-latency or Core Web Vitals improvement. Nothing is deployed by this
change. After deployment, repeat the same destination/date/device measurements
and smoke-test room selection, checkout, disabled service flags, and chat handoff.

## Search pipeline follow-up

### Changes

- Hotel catalogs load on opening the location menu or map. The small country /
  destination list still loads on mount so city selection stays available. Opening
  the picker loads the global hotel pool, preserving search across destinations.
- Browser catalogs share pending loads and cache successful raw responses for
  30 minutes (8 country entries / 32 destination hotel entries). They survive
  component remounts and client navigation, but not a full page reload. Pricing
  from live search results is still applied separately to map options.
- Country and destination hotel catalogs share pending supplier requests in each
  server process and retain the existing six-hour TTL, bounded to 256 country /
  128 destination entries. This is not a cross-process cache. Failures are never
  cached; reopening the picker retries failed entries. A failed destination does
  not erase successful catalogs. The country response deadline now covers its body.
- Search history and its authentication lookup run through Next.js `after()` on
  the API, Server Action, and server-rendered results paths. Request headers are
  captured before scheduling, which also supports Server Components. History
  remains best effort; history failure does not delay delivery of search results.
- The results page now POSTs to `/api/aoryx/results-search` with an AbortController.
  Changing the search or unmounting aborts the request; the route forwards its
  signal to the supplier fetch and body read. Cancellation is not retried or
  classified as a supplier timeout. Obsolete responses cannot replace new results.
- The browser request key contains only supplier search parameters, excluding
  display-only URL fields. Results remain uncached (`private, no-store`); supplier
  sessions and booking tokens are not shared across users.
- The old `/api/aoryx/search` still uses its B2C fee lookup. The new results endpoint
  preserves `runAoryxSearch` and its existing B2B fee lookup, just like the previous
  results Server Action and SSR path. Changing that pricing policy requires a
  separate product decision; this optimization does not change either fee.
- Fixed a false-positive font check that treated `history` in the new helper
  import path as an icon. The scanner now skips static/dynamic module paths while
  retaining real JSX, conditional, CSS, and JSON icon literals. Regenerated fonts
  and manifest together: 242,708 / 324,944 bytes, 282 icons each. Deploy the scanner,
  manifest, and both font files together; the checksum check remains enabled.
  Regression check: `node --test tests/icon-source-tokens.test.mjs`.

### Measurements and validation

The results endpoint returns `Server-Timing` entries:

- `supplier_search`: supplier request, body read, and response normalization.
- `pricing`: platform fee lookup, running concurrently with the supplier request.
- `search_total`: complete search, including markup and search token generation.

These timings overlap; do not add supplier and pricing durations. The header does
not include browser rendering or deferred history work. Inspect it in DevTools
Network alongside request duration, then use the Performance panel for rendering.
No search parameters, credentials, sessions, or tokens are emitted in these metrics.

`node --test tests/search-performance.test.mjs` runs eight isolated regression
tests with fake auth/pricing and supplier responses. They execute the real route,
supplier client, token, and cache code; cover pricing differences, token context,
deferred history, cancellation without retries, expiry/eviction, concurrent loads,
failure recovery, and malformed inputs. They do not make live supplier/DB calls.

The temporary browser fixture confirmed no hotel catalog calls before interaction,
one call per destination on first open, reuse after remount, keyboard menu access,
map markers, and stalled-search replacement with an abort event and the newer
result. The fixture and generated development types were removed before the
production build. Production build and TypeScript pass; the new/shared code has
no lint errors, and touched legacy components retain baseline findings.

### Production verification still required

No deployment or live supplier latency improvement is claimed. The authenticated
room-selection/checkout smoke test and real `Server-Timing` comparison remain due.
Browser cancellation depends on the deployment forwarding disconnects to the Next
request signal; test that through the real proxy. Direct document SSR searches and
external callers of the old Server Action do not expose browser cancellation.
Deferred history depends on the server remaining alive until `after()` completes.

Mobile hero height and fixed filter/package controls still need a design pass.
Third-party chat loading and supplier response latency remain measurement targets.

## General performance pass — September 17, 2026

### Page loading

- `lib/i18n.ts` now contains only locale configuration and types. Dictionary values
  and `getTranslations` live in `lib/i18n-server.ts`, protected by `server-only`.
  Server pages and metadata import the server module; the locale layout passes
  only the selected dictionary to `LanguageProvider`. All translation values are
  unchanged. The provider takes locale and dictionary from the same server render,
  so navigation cannot combine a new locale with the previous dictionary.
- Moved 898 lines of admin styles out of global CSS into
  `app/[locale]/admin/admin.css`, imported by the admin layout. Mobile admin rules
  moved with them; shared profile styles remain global. These styles use existing
  admin-specific selectors, so they remain safe if Next retains the stylesheet
  after navigating away from admin.

Production homepage entry assets, measured from local build artifacts:

| Measurement | Before | After |
| --- | ---: | ---: |
| JavaScript, uncompressed (each locale) | 915,701 B | 703,727 B |
| JavaScript, gzip estimate | 282,094 B | 223,805 B |
| CSS, uncompressed | 228,494 B | 216,458 B |
| CSS, gzip estimate | 36,862 B | 34,981 B |
| Armenian HTML + JS + CSS, gzip estimate | 382,155 B | 345,744 B |
| English HTML + JS + CSS, gzip estimate | 379,806 B | 340,584 B |
| Russian HTML + JS + CSS, gzip estimate | 382,703 B | 347,628 B |

JavaScript is 23.1% smaller uncompressed / 20.7% smaller with gzip. Selected
translations now appear in the document's React payload, increasing HTML size;
including that increase, the combined gzip estimate falls by 9.2–10.3%.
These are cold document and entry-asset measurements, excluding fonts, images,
third-party resources, later dynamic imports, request headers, and navigation RSC
responses. Actual server compression and browser timings may differ. This is not
a measured Core Web Vitals or end-to-end page speed improvement.

### Database availability

`lib/mongodb.ts` retains one MongoClient per process without opening a connection
on import. DB helpers explicitly call `connectMongoClient()`. Better Auth keeps
its Mongo adapter configured before connecting and calls the same helper in its
before hook. Legacy profile lookups also connect before accessing collections.
A failed connection rejects that request; subsequent requests can try again on
that same client. There is no application retry loop and no booking mutation is
replayed. Pool size and driver timeouts are unchanged.

This uses the installed driver's `connect()` lock: concurrent attempts share a
connection, connected clients return immediately, and failed attempts release the
lock. The previous top-level promise could remain rejected forever and caused
Better Auth to initialize without its Mongo adapter after a startup outage.

### Repeatable checks

```sh
npm run typecheck
npm run test:performance
npm run build
npm run perf:report
```

`perf:report` prints JSON with raw and gzip sizes from the production artifacts;
optional arguments select prerendered routes, e.g. `npm run perf:report -- en`.
It includes HTML to keep server/client payload comparisons honest. It is a report,
not a hard budget or CI enforcement. Dynamic routes require browser measurements.

Validation for this pass:

- Production build, TypeScript, focused lint on every touched TypeScript file and
  new script/test, font coverage/checksums, and diff whitespace checks pass.
- 29 targeted tests pass across performance, icon scanning, DB recovery, booking
  flow, and insurance pricing/checkout. The new DB regression executes real driver
  connection locking and the real Better Auth session API while replacing the
  network-opening operation; it does not contact a database or supplier.
- Compared every translated value with the previous committed dictionary: exact
  match in all three languages.
- Local production browser: English → Russian → Armenian switching updates
  headings, search labels, footer, and document language while retaining query
  parameters. Admin still shows its sign-in gate and loads its separate CSS;
  homepage entry styles contain no admin selectors. Authenticated admin screens
  and a real database outage were not exercised.
- Local browser supplier catalog calls remain unavailable without `AORYX_API_KEY`.
  No deployment or authenticated supplier-backed checkout was performed.

Include the new server translation module, admin layout/CSS, reporting script,
recovery test, and existing performance test files in the same commit as their
callers and package scripts. No dependency upgrade is required.

### Remaining broader work

Measure authenticated results, hotel detail, checkout, and admin with production
supplier data; load human-agent chat only when requested; split optional checkout
and service UI with route-level measurements; profile slow database queries and
indexes; and introduce settings caching together with explicit invalidation on
admin edits. These are separate follow-ups; this pass does not change pricing,
payment behavior, or the existing third-party chat lifecycle.
