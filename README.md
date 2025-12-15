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
See `.env.example` and set:
```
NEXTAUTH_SECRET=generated-secret
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

3) Start dev server  
`npm run dev` then open http://localhost:3000

## Google OAuth setup (console.cloud.google.com)
- Create OAuth client credentials → Web application.
- Authorized origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
- Copy the client ID/secret into `.env.local`.

## Scripts
- `npm run dev` – start Next.js dev server.
- `npm run build` – production build.
- `npm run start` – run the built app.
- `npm run lint` – lint the codebase.

## Notes
- Remote images are allowed from Unsplash and Google profile images (`lh3.googleusercontent.com`).
- Authentication UI is in `components/auth-actions.tsx`; NextAuth config lives at `app/api/auth/[...nextauth]/route.ts` with options in `lib/auth.ts`.
