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
You can fetch valid destination codes from `GET /v1/destinations` (this endpoint returns only top-level codes ending with `-0`).

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

You can include local addon bookings in the same request:

- `transferSelection` (local transfer booking)
- `excursions` (local excursion booking)
- `insurance` with `provider: "efes"` (policy issuance through EFES endpoint)

Transfer field rules:

- Always required: `transferSelection.flightDetails.flightNumber`, `transferSelection.flightDetails.arrivalDateTime`
- If `transferSelection.includeReturn` is `true`, also required:
  `transferSelection.flightDetails.departureFlightNumber`,
  `transferSelection.flightDetails.departureDateTime`

Insurance input rules (for `insurance.provider = "efes"`):

- Required insurance fields: `territoryCode`, `riskAmount`, `riskCurrency`, `travelers[]`
- `provider` is optional (defaults to `efes`)
- `planId` is optional (defaults to `efes-travel`)
- For each traveler, send UI-entered identity/passport/contact/address fields:
  `firstName`, `lastName`, `gender`, `birthDate`, `passportNumber`, `passportAuthority`,
  `passportIssueDate`, `passportExpiryDate`, `residency`, `citizenship`,
  `mobilePhone`, `email`, `premium`, `premiumCurrency`, and `address.{full,country,region,city}`
- EFES internal/default fields are set server-side by Megatours.

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
    }],
    "transferSelection": {
      "id": "transfer-1",
      "includeReturn": true,
      "flightDetails": {
        "flightNumber": "FZ171",
        "arrivalDateTime": "2026-03-10T08:30:00+04:00",
        "departureFlightNumber": "FZ172",
        "departureDateTime": "2026-03-15T19:45:00+04:00"
      },
      "totalPrice": 120
    },
    "excursions": {
      "totalAmount": 90,
      "selections": [{ "id": "EXC-101", "quantityAdult": 2, "priceAdult": 45, "currency": "USD" }]
    },
    "insurance": {
      "provider": "efes",
      "planId": "efes-plan-1",
      "territoryCode": "25",
      "riskAmount": 15000,
      "riskCurrency": "EUR",
      "travelers": [{
        "id": "trav-1",
        "firstName": "Ջոն",
        "lastName": "Դոե",
        "firstNameEn": "John",
        "lastNameEn": "Doe",
        "gender": "M",
        "birthDate": "1992-01-14",
        "residency": true,
        "socialCard": "1234567890",
        "passportNumber": "AB1234567",
        "passportAuthority": "Police of RA",
        "passportIssueDate": "2022-01-10",
        "passportExpiryDate": "2032-01-10",
        "citizenship": "AM",
        "mobilePhone": "+37491111222",
        "email": "john.doe@example.com",
        "premium": 12,
        "premiumCurrency": "EUR",
        "address": {
          "full": "10 Northern Ave",
          "fullEn": "10 Northern Ave, Yerevan",
          "country": "AM",
          "region": "YR",
          "city": "YR01"
        }
      }]
    }
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

## `/v1/hotels/book` response examples

### All services booked

```json
{
  "requestId": "4f18b2a2-0d33-44dd-9f7f-f8a7e95cfc0f",
  "data": {
    "sessionId": "",
    "status": "Confirmed",
    "hotelConfirmationNumber": "HTL-987654",
    "adsConfirmationNumber": "ADS-445566",
    "supplierConfirmationNumber": "SUP-22991",
    "customerRefNumber": "PARTNER-1001",
    "rooms": [
      { "roomIdentifier": 1, "rateKey": null, "status": "Confirmed" }
    ],
    "services": {
      "transfer": { "status": "booked", "referenceId": "TRF-20260213121010-ab12cd34", "message": null },
      "excursions": { "status": "booked", "referenceId": "EXC-20260213121010-ef56gh78", "message": null, "items": 1 },
      "insurance": {
        "status": "booked",
        "referenceId": "INS-20260213121010-ij90kl12",
        "message": null,
        "provider": "efes",
        "policies": [
          { "travelerId": "trav-1", "response": { "policy_number": "EF-123456" } }
        ]
      }
    }
  }
}
```

### Hotel booked, insurance failed

```json
{
  "requestId": "5b2e21ad-b9ce-4c7f-9504-c3e533110488",
  "data": {
    "sessionId": "",
    "status": "Confirmed",
    "hotelConfirmationNumber": "HTL-123456",
    "adsConfirmationNumber": "ADS-778899",
    "supplierConfirmationNumber": "SUP-99001",
    "customerRefNumber": "PARTNER-1002",
    "rooms": [
      { "roomIdentifier": 1, "rateKey": null, "status": "Confirmed" }
    ],
    "services": {
      "transfer": { "status": "booked", "referenceId": "TRF-20260213121540-aa11bb22", "message": null },
      "excursions": { "status": "skipped", "referenceId": null, "message": null, "items": 0 },
      "insurance": {
        "status": "failed",
        "referenceId": null,
        "message": "Failed to issue EFES insurance policies.",
        "provider": "efes",
        "policies": null
      }
    }
  }
}
```

## Error catalog

Common API errors:

- `400 Invalid JSON payload` - malformed JSON body.
- `400 Transfer flight details are required: flightNumber and arrivalDateTime.` - missing required transfer arrival fields.
- `400 Return transfer requires departure flight details: departureFlightNumber and departureDateTime.` - return transfer selected but departure fields are missing.
- `400 Invalid booking payload` - required booking fields are missing/invalid.
- `400 Missing insurance field: territoryCode.` (or `riskAmount`, `riskCurrency`, `travelers`) - required insurance top-level field is missing.
- `400 Incomplete insurance traveler field: travelers[0].<field> is required.` - traveler input is incomplete (for example: `passportNumber`, `birthDate`, `mobilePhone`, `address.full`).
- `400 Unsupported insurance provider. Expected provider=efes.` - unsupported insurance provider value.
- `401 Missing bearer token` - no `Authorization: Bearer ...` header.
- `401 Invalid bearer token` - token not found in `B2B_API_CLIENTS_JSON`.
- `403 Scope is not allowed for insurance policy issuance` - client called hotel booking with insurance payload without `insurance:quote` scope.
- `403 Client IP is not allowed` - caller IP is not in `allowedIps`.
- `429 Rate limit exceeded` - client hit per-minute request limit.
- `503 B2B API clients are not configured` - server missing B2B client env config.

## Partner onboarding checklist

1. Issue partner token and configure `B2B_API_CLIENTS_JSON` with required scopes (`hotels:search`, `hotels:book`, and `insurance:quote` if using insurance).
2. Add partner outbound static IPs to `allowedIps`.
3. Share base URL (`https://megatours.cloud/v1`) and OpenAPI spec (`b2b-openapi.yaml`).
4. Complete smoke flow:
`/v1/destinations` -> `/v1/hotels/search` -> `/v1/hotels/room-details` -> `/v1/hotels/prebook` -> `/v1/hotels/book`.
5. Check rate-limit headers on every request:
`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`.
6. Rotate tokens periodically and immediately after any exposure.

## Security notes

- Supplier keys stay server-side in existing environment variables.
- `/v1/*` is excluded from locale middleware redirects.
- Current rate limiter is in-memory; for horizontally scaled deployments, move this to Redis (shared store).
