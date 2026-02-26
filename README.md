# AORYX Stays — B2C hotel booking

Next.js 16 + Tailwind CSS landing for AORYX hotel bookings with Google sign-in via NextAuth. The homepage highlights B2C-ready inventory, perks, and a booking flow with a live-style search bar.

## Stack
- Next.js 16 / App Router / React 19
- Tailwind CSS v4 (postcss plugin)
- NextAuth (Google provider) for authentication

## Run locally
1) Install deps  
`npm install`

2) Create a `.env.local` from the sample  
Set:
```
NEXTAUTH_SECRET=generated-secret
NEXTAUTH_URL=http://localhost:3000
VPOS_PUBLIC_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
MONGODB_URI=your-mongodb-uri
MONGODB_DB=megatours_am
IDRAM_REC_ACCOUNT=your-idram-id
IDRAM_SECRET_KEY=your-idram-secret
IDRAM_LANGUAGE=EN
VPOS_BASE_URL=https://ipaytest.arca.am:8445/payment/rest
VPOS_USER=your-idbank-vpos-user
VPOS_PASSWORD=your-idbank-vpos-password
VPOS_CURRENCY_CODE=051
VPOS_CURRENCY_DECIMALS=2
AMERIA_VPOS_BASE_URL=https://servicestest.ameriabank.am/VPOS
AMERIA_VPOS_CLIENT_ID=your-ameria-client-id
AMERIA_VPOS_USERNAME=your-ameria-username
AMERIA_VPOS_PASSWORD=your-ameria-password
AMERIA_VPOS_LANGUAGE=en
AMERIA_VPOS_CURRENCY_CODE=051
AMERIA_VPOS_CURRENCY_DECIMALS=2
AMERIA_VPOS_TEST_ORDER_ID_MIN=4191001
AMERIA_VPOS_TEST_ORDER_ID_MAX=4192000
AMERIA_VPOS_TEST_AMOUNT_AMD=10
EFES_ENV=staging
EFES_BASE_URL=https://stagingimex.efes.am
EFES_BASE_URL_PROD=https://imex.efes.am
EFES_USER=your-efes-user
EFES_PASSWORD=your-efes-password
EFES_COMPANY_ID=your-efes-company-id
EFES_POLICY_TEMPLATE_DESCRIPTION=229
EFES_TIMEOUT_MS_RAW=15000
NEXT_PUBLIC_ZOHO_SALESIQ_SCRIPT_URL=https://salesiq.zohopublic.com/widget?wc=your-widget-code
NEXT_PUBLIC_ZOHO_SALESIQ_FALLBACK_URL=https://your-support-page-or-salesiq-link
```

3) Start dev server  
`npm run dev` then open http://localhost:3000

## Google OAuth setup (console.cloud.google.com)
- Create OAuth client credentials → Web application.
- Authorized origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- Copy the client ID/secret into `.env.local`.

## Idram payment setup
- Provide Idram with URLs to configure:
  - RESULT_URL: `http://localhost:3000/api/payments/idram/result`
  - SUCCESS_URL: `http://localhost:3000/payment/success`
  - FAIL_URL: `http://localhost:3000/payment/fail`

## Card payment setup
- `VPOS_PUBLIC_ORIGIN` controls where payment result redirects land (`/payment/success` / `/payment/fail`).
- For local development set: `VPOS_PUBLIC_ORIGIN=http://localhost:3000`.
- IDBank VPOS callback URL:
  - `http://localhost:3000/api/payments/vpos/result`
- Ameriabank VPOS callback URL (`BackURL` in InitPayment):
  - `http://localhost:3000/api/payments/vpos/result`
- In Ameriabank test environment, keep `OrderID` in `4191001-4192000` and `Amount=10 AMD` (handled by `AMERIA_VPOS_TEST_*` env vars).

## Scripts
- `npm run dev` – start Next.js dev server.
- `npm run build` – production build.
- `npm run start` – run the built app.
- `npm run lint` – lint the codebase.

## Notes
- Remote images are allowed from Unsplash and Google profile images (`lh3.googleusercontent.com`).
- Authentication UI is in `components/auth-actions.tsx`; NextAuth config lives at `app/api/auth/[...nextauth]/route.ts` with options in `lib/auth.ts`.
