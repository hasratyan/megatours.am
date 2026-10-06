# Next.js 16.4 adoption

## Static public routes

The homepage, destination pages, privacy policy, and refund policy export
`ensureStatic = "navigation"`. Their server output must stay prerenderable;
uncached database work or request-specific server data fails development/build
validation even inside Suspense. The localized layout and destination route
provide static parameters. Each page also puts URL-dependent content inside its
own Suspense boundary.

Hotel pages use `ensureStatic = "prefetch"`. Profile, admin, checkout, payments,
and supplier availability retain their existing request-time behavior.

## Hotel navigation

`HotelClient` receives the hotel identity, address, coordinates, contact details,
and one image. The full gallery and amenity UI are server-rendered slots behind
`navigation()` and Suspense, with a primary-photo fallback for the gallery.
Gallery URL deduplication runs on the server; full-size supplier photos win
over thumbnails without changing the supplier's ordering.

The hotel JSON-LD keeps five photos and the existing amenity metadata instead
of duplicating every gallery URL. Initial page loads still include the full
gallery. Runtime prefetches defer the slots; static prerenders may include
already-generated content, as documented by Next.js.

Only public hotel content uses the shared cache. Availability, rate validation,
and booking remain fresh request-time operations.

## Visitor dates

The search date label uses React 19.3 `use(browser())` inside Suspense. The server
renders the existing date placeholder, and default dates are constructed from
the visitor's clock in the browser. Explicit search dates retain their values.

## Bundle analysis

```sh
npm run perf:bundle -- --snapshot before
npm run perf:bundle:export -- --snapshot before > before.jsonl
# Make an optimization, capture an after snapshot, and compare the graphs.
npm run perf:bundle -- --snapshot after
npm run perf:bundle:export -- --snapshot after > after.jsonl
```

The 16.4 analyzer's bootstrap/render-dependent groups identified an eager
`react-select` dependency used only by checkout insurance controls. Those
controls now load through `next/dynamic` when rendered, preserving their props,
options, change handlers, and pricing behavior. The original snapshot showed
749,234 initial JavaScript bytes; the final optimized snapshot showed 663,765
(85,469 fewer bytes, 11.4%). These are analyzer module/chunk totals, not compressed
network transfer measurements. Local captures live in `output/next164/`.

## Development options

`turbopackGc` and `turbopackLazyDynamicImports` are enabled only when
`NODE_ENV === "development"`. Production uses their defaults. The existing
annotation-based Rust React Compiler configuration remains enabled.

If type checking after an upgrade rejects a new `next/cache` export while the
installed declaration contains it, check generated `.next/dev/types` for stale
ambient declarations. Starting the upgraded `next dev` regenerates those types;
do not patch dependency declarations or disable type checking.
