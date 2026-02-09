# Megatours B2B Gateway (megatours.cloud)

This repository now includes a versioned B2B API gateway exposed at root paths:

- `GET /v1/health`
- `GET /v1/destinations`
- `POST /v1/hotels/search`
- `POST /v1/hotels/info`
- `POST /v1/hotels/room-details`
- `POST /v1/hotels/prebook`
- `POST /v1/hotels/book`
- `POST /v1/transfers/search`
- `POST /v1/excursions/search`
- `POST /v1/insurance/quote`

The gateway sits in front of supplier APIs (Aoryx/Efes). Partner clients never receive supplier credentials.

## Domain and deployment

You can run this without a subdomain:

- API base URL: `https://megatours.cloud/v1`
- No `api.` prefix required

Important:

- Configure DNS `A/AAAA/CNAME` for `megatours.cloud` to your deployment.
- Enable TLS for `megatours.cloud`.
- If you also serve other apps on this host, keep `/v1/*` routed to this Next.js app.

## Auth model (implemented)

Authentication is `Authorization: Bearer <token>`.

Per-client controls:

- Scopes
- Per-minute rate limits
- Optional IP allowlist

Headers returned:

- `x-request-id`
- `x-b2b-client-id`
- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset` (unix seconds)

## Environment variables

Add these in your deployment environment:

```env
# Optional hard host restriction (recommended in production)
B2B_API_ALLOWED_HOSTS=megatours.cloud

# Default if client-level rateLimitPerMinute is omitted
B2B_API_DEFAULT_RATE_LIMIT_PER_MINUTE=120

# Preferred: JSON list of clients
B2B_API_CLIENTS_JSON=[{"id":"partner-a","name":"Partner A","token":"replace_with_secret","scopes":["hotels:search","hotels:book","insurance:quote"],"rateLimitPerMinute":60,"allowedIps":["203.0.113.10"]}]

# Optional fallback for one global client (full scope)
# B2B_API_TOKEN=replace_with_single_shared_token
```

Generate strong tokens:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Request examples

### 1) Health check

```bash
curl -s https://megatours.cloud/v1/health
```

### 2) Aoryx hotel search

Use supplier destination codes (example: `160-0` for Dubai).  
You can fetch valid destination codes from `GET /v1/destinations`.

```bash
curl -s https://megatours.cloud/v1/hotels/search \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationCode": "160-0",
    "countryCode": "AE",
    "nationality": "AM",
    "currency": "USD",
    "checkInDate": "2026-03-10",
    "checkOutDate": "2026-03-15",
    "rooms": [{"roomIdentifier": 1, "adults": 2, "childrenAges": []}]
  }'
```

### 3) Hotel info (images, amenities, geo/contact)

```bash
curl -s https://megatours.cloud/v1/hotels/info \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{"hotelCode":"71190"}'
```

### 4) Room details with meal/refund/cancellation facets

```bash
curl -s https://megatours.cloud/v1/hotels/room-details \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelCode": "71190",
    "destinationCode": "160-0",
    "checkInDate": "2026-03-10",
    "checkOutDate": "2026-03-15",
    "rooms": [{"roomIdentifier": 1, "adults": 2, "childrenAges": []}]
  }'
```

Response includes:

- `rooms[].meal`, `rooms[].boardType`, `rooms[].cancellationPolicy`, `rooms[].policies`, `rooms[].remarks`
- `facets.mealPlans`, `facets.refundability`, `facets.cancellationPolicies`, `facets.rateTypes`, `facets.priceRange`

### 5) Prebook selected rates

Use `rateKeys` returned from `/v1/hotels/room-details` (opaque tokens) unchanged.

```bash
curl -s https://megatours.cloud/v1/hotels/prebook \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelCode": "71190",
    "rateKeys": ["<room_rate_token_1>", "<room_rate_token_2>"]
  }'
```

### 6) Complete hotel booking

Use selected room entries from `/v1/hotels/prebook` (keep `rateKey`, `price`, and guest details).

```bash
curl -s https://megatours.cloud/v1/hotels/book \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelCode": "71190",
    "destinationCode": "160-0",
    "checkInDate": "2026-03-10",
    "checkOutDate": "2026-03-15",
    "customerRefNumber": "PARTNER-1001",
    "rooms": [{
      "roomIdentifier": 1,
      "adults": 2,
      "childrenAges": [],
      "rateKey": "<room_rate_token_1>",
      "guests": [
        { "firstName": "John", "lastName": "Doe", "type": "Adult", "age": 33, "isLeadGuest": true },
        { "firstName": "Jane", "lastName": "Doe", "type": "Adult", "age": 31 }
      ],
      "price": { "gross": 500, "net": 450, "tax": 50 }
    }]
  }'
```

### 7) Destination code lookup

```bash
curl -s "https://megatours.cloud/v1/destinations?countryCode=AE&q=dubai&limit=20" \
  -H "Authorization: Bearer <partner_token>"
```

### 8) Transfers (addons)

```bash
curl -s https://megatours.cloud/v1/transfers/search \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationLocationCode": "160-0",
    "transferType": "INDIVIDUAL",
    "paxCount": 2,
    "travelDate": "2026-03-10"
  }'
```

### 9) Excursions (addons)

```bash
curl -s https://megatours.cloud/v1/excursions/search \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'
```

### 10) Efes insurance quote

```bash
curl -s https://megatours.cloud/v1/insurance/quote \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-03-10",
    "endDate": "2026-03-15",
    "territoryCode": "25",
    "riskAmount": 15000,
    "riskCurrency": "EUR",
    "travelers": [{"id":"t1","age":33}],
    "subrisks": ["BAGGAGE_EXPENCES"]
  }'
```

## Security notes

- Supplier keys stay server-side in existing environment variables.
- `/v1/*` is excluded from locale middleware redirects.
- Current rate limiter is in-memory; for horizontally scaled deployments, move this to Redis (shared store).
