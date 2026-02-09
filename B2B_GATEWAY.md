# Megatours B2B Gateway (megatours.cloud)

This repository now includes a versioned B2B API gateway exposed at root paths:

- `GET /v1/health`
- `POST /v1/hotels/search`
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
B2B_API_CLIENTS_JSON=[{"id":"partner-a","name":"Partner A","token":"replace_with_secret","scopes":["hotels:search","insurance:quote"],"rateLimitPerMinute":60,"allowedIps":["203.0.113.10"]}]

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

```bash
curl -s https://megatours.cloud/v1/hotels/search \
  -H "Authorization: Bearer <partner_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "destinationCode": "DXB",
    "countryCode": "AE",
    "nationality": "AM",
    "currency": "USD",
    "checkInDate": "2026-03-10",
    "checkOutDate": "2026-03-15",
    "rooms": [{"roomIdentifier": 1, "adults": 2, "childrenAges": []}]
  }'
```

### 3) Efes insurance quote

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

