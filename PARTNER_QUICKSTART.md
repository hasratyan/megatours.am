# Megatours B2B API Quickstart

Base URL: `https://megatours.cloud`

## 1) Authentication

Send bearer token on every protected request:

```http
Authorization: Bearer <partner_token>
```

For all `POST` calls also send:

```http
Content-Type: application/json
```

## 2) First calls (recommended order)

1. `GET /v1/health`
2. `GET /v1/destinations?countryCode=AE&q=dubai&limit=20`
3. `POST /v1/hotels/search`
4. `POST /v1/hotels/room-details`
5. `POST /v1/hotels/prebook`
6. `POST /v1/hotels/book`

Optional services:

7. `POST /v1/transfers/search`
8. `POST /v1/excursions/search`
9. `POST /v1/insurance/quote`

## 3) Minimal working examples

### Health

```bash
curl -s https://megatours.cloud/v1/health
```

### Destination lookup

```bash
curl -s "https://megatours.cloud/v1/destinations?countryCode=AE&q=dubai&limit=20" \
  -H "Authorization: Bearer <partner_token>"
```

### Hotel search

```bash
curl -s https://megatours.cloud/v1/hotels/search \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationCode": "160-0",
    "checkInDate": "2026-03-10",
    "checkOutDate": "2026-03-15",
    "rooms": [{"roomIdentifier":1,"adults":2,"childrenAges":[]}]
  }'
```

### Room details

```bash
curl -s https://megatours.cloud/v1/hotels/room-details \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelCode": "71190",
    "checkInDate": "2026-03-10",
    "checkOutDate": "2026-03-15"
  }'
```

### Prebook

```bash
curl -s https://megatours.cloud/v1/hotels/prebook \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelCode": "71190",
    "rateKeys": ["<room_rate_token_1>"]
  }'
```

### Book

```bash
curl -s https://megatours.cloud/v1/hotels/book \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "hotelCode": "71190",
    "destinationCode": "160-0",
    "rooms": [{
      "roomIdentifier": 1,
      "adults": 2,
      "childrenAges": [],
      "rateKey": "<room_rate_token_1>",
      "guests": [{
        "firstName": "John",
        "lastName": "Doe",
        "type": "Adult",
        "age": 33,
        "isLeadGuest": true
      }],
      "price": {"gross": 500, "net": 450}
    }]
  }'
```

## 4) Required fields by endpoint

- `GET /v1/health`
  No body.
- `GET /v1/destinations`
  Optional query: `countryCode`, `q`, `limit`.
- `POST /v1/hotels/search`
  Required: `checkInDate`, `checkOutDate`, and one of `destinationCode` or `hotelCode`.
- `POST /v1/hotels/info`
  Required: `hotelCode`.
- `POST /v1/hotels/room-details`
  Required: `hotelCode`, `checkInDate`, `checkOutDate`.
- `POST /v1/hotels/prebook`
  Required: `hotelCode`, `rateKeys[]`.
  If sending raw supplier `rateKeys`, also send `sessionId` and `groupCode`.
- `POST /v1/hotels/book`
  Required top-level: `hotelCode`, `destinationCode`, `rooms[]`.
  Required room fields: `roomIdentifier`, `adults`, `rateKey`, `guests[]`, `price.gross`, `price.net`.
- `POST /v1/transfers/search`
  Required: one of `destinationLocationCode` or `destinationName`.
- `POST /v1/excursions/search`
  No required fields.
- `POST /v1/insurance/quote`
  Required: `startDate`, `endDate`, `territoryCode`, `riskAmount`, `riskCurrency`, `travelers[]`.
  Required traveler field: `age`.

## 5) Common errors

- `400` Invalid or missing required request fields.
- `401` Missing/invalid bearer token.
- `403` Scope/IP restriction.
- `429` Rate limit exceeded.
- `500` Internal gateway error.
- `502` Upstream provider communication error.

Every response includes `requestId`. Keep it in logs for support requests.

## 6) Production readiness

1. Use static outbound IP and share it with Megatours for allowlisting.
2. Implement retries for `429`, `500`, `502` with exponential backoff.
3. Use idempotent `customerRefNumber` on booking calls.
4. Monitor `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`.

