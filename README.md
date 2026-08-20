# Passenger app — file package

Everything here is real, working code for the `taxi-passenger-pwa` repo —
not mockups. Give this whole folder to Claude Code and ask it to set up
a Vite + React project using it.

## Folder structure (already correct — don't rearrange)

```
src/                          → copy into your Vite project's src/ folder, flat
  passenger-booking.jsx           screen: driver landing page + booking form
  passenger-booking-status.jsx    screen: booking confirmation + live tracking
  FareEstimateScreen.jsx          screen: real fare calc + live map
  PaymentScreen.jsx               screen: real Stripe Elements payment
  BookingConfirmedScreen.jsx      screen: post-payment success moment
  GuestAccountChoice.jsx          screen: optional account creation prompt
  AccountHistoryScreen.jsx        screen: trip history + saved locations
  LiveMapView.jsx                 component: real Mapbox GL JS map
  fareCalculator.js               logic: tariff periods, fare math (TESTED)
  mapboxClient.js                 logic: address search, routing (parsing TESTED)
  stripeHelpers.js                logic: euro→cents conversion (TESTED)
  bookingHistory.js               logic: sort/categorize bookings (TESTED)

supabase/functions/           → deploy separately via Supabase CLI, don't
  create-booking/index.ts         bundle into the Vite app
  _shared/fareCalculator.ts       (same tested logic, ported to Deno/TS)
```

Files inside `src/` import each other by relative path (e.g.
`FareEstimateScreen.jsx` does `import { getRoute } from "./mapboxClient"`)
— they must stay in the same flat folder for those imports to resolve.

## What's tested vs. not

Tested with real test runs (see conversation history for the actual test
output): `fareCalculator.js`, the parsing functions in `mapboxClient.js`,
`stripeHelpers.js`, `bookingHistory.js`, and the Deno port in the Edge
Function — verified to produce identical results to the Node version.

Written correctly, following real documented patterns, but NOT yet run
against live services (no network path to Mapbox/Stripe/Supabase from the
sandbox this was built in): the actual `fetch()` calls, the live map
render, the Stripe Elements flow, and every database/Stripe call inside
the Edge Function. The first real test happens once this runs in your
actual project with real keys.

## Setup steps

1. `npm install mapbox-gl @stripe/stripe-js @stripe/react-stripe-js @supabase/supabase-js lucide-react`
2. Copy everything in `src/` above into your project's `src/`
3. Create `.env` with:
   ```
   VITE_SUPABASE_URL=https://xigqjacbhvrvpqaxtsxu.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_MAPBOX_TOKEN=your-mapbox-public-token
   VITE_STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
   ```
4. Deploy the Edge Function (from your Supabase project directory, not the Vite app):
   ```
   supabase functions deploy create-booking
   supabase secrets set MAPBOX_TOKEN=your-mapbox-server-token
   supabase secrets set STRIPE_SECRET_KEY=your-stripe-secret-key
   supabase secrets set PLATFORM_FEE_PERCENT=10
   ```
5. `npm run dev` and test in a real browser — this is the actual first
   live test of the Mapbox map, address search, and Stripe payment flow.

## Known open items

- No real Irish public-holiday calendar wired in yet (only the
  Christmas/New Year windows the NTA explicitly names) — see the comment
  in `fareCalculator.js` / `fareCalculator.ts`.
- `PLATFORM_FEE_PERCENT` defaults to 10% only so the Edge Function doesn't
  crash — confirm the real number before this touches real payments.
- No screens exist yet for driver's-side booking acceptance or the
  passenger signup/login flow itself — this package covers browsing,
  booking, paying, and tracking as a guest or returning customer.
