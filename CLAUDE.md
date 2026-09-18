# Taxi Passenger PWA — Customer Booking App

One of three apps sharing a single Supabase backend (project ref `xigqjacbhvrvpqaxtsxu`). This is the **customer-facing** booking app. The other two: `Taxi-admin-Dashboard` (driver app) and `owner-dashboard` (platform oversight).

**This repo also hosts every shared backend edge function** (`supabase/functions/`) used by all three apps, not just this one — deploy from here regardless of which app a fix is for.

## Stack
Vite + React 19 (JS/JSX, not TypeScript) + Tailwind. Deployed on Vercel.

## Regression watchlist — verified fixed, check before touching nearby code
These have each broken, or needed multiple attempts to actually fix. Before editing anything in this area, re-read this first — don't rediscover the same root cause from scratch.

- **Every customer-facing push notification URL must include the driver's `booking_slug` prefix** — e.g. `/${slug}?screen=status&booking=${id}`, never a bare `/?screen=...`. `App.jsx` resolves `driverId` **only** from the URL path slug (`window.location.pathname`) — a notification URL missing the slug silently loses all driver context, which cascades into the chat button disappearing (it's nested inside driver-info rendering) and driver-scoped API calls failing with errors like "driver not associated." Already broke once from exactly this cause. Any new push-sending code must fetch `drivers.booking_slug` and include it.
- **Every driver-facing push notification URL must use the driver app's real path-based routing (`/bookings`, `/pool-jobs`, `/settings`), never `/?screen=bookings`-style query params.** That query-param convention belongs to the *passenger* app specifically — the driver app (`Taxi-admin-Dashboard`) only understands real paths (see `SCREEN_PATHS`/`screenFromPath` in its `App.tsx`). This was wrong in **seven separate places** at once (`cancel-booking`, `confirm-booking-payment`, `create-booking`, `send-message`, and three spots in `send-ride-reminders`) — found only when specifically searched for across the whole codebase, not by fixing one at a time. **Any time a driver notification's target URL is added or changed anywhere, grep the whole repo for `type: "driver"` notification calls and check every one, not just the one being edited** — this bug proved to hide in places far from wherever the immediate symptom was reported.
- **`STATUS_MESSAGES` in `notify-status-push/index.ts` needs an entry for every booking status a passenger should be told about.** `confirmed` was missing entirely for a real stretch — driver accepting a booking sent no notification at all — caught only when explicitly reported, not by inspection. If a new status is ever added to the booking lifecycle, add its message here too.
- **`isSharedView` must be explicitly set on every path that loads a booking, not left to inherit whatever it happened to be.** It only had one reset path ("Book Again") — meaning once a shared trip link was opened even once in a browser session, it stayed stuck `true` for every booking viewed afterward, silently hiding chat (and Cancel/Rate/Tip) even for the passenger's own, completely unrelated bookings. Every `setBookingResult(...)` call for a genuinely owned booking must be paired with an explicit `setIsSharedView(false)` right alongside it — don't assume default state is safe.
- **The theme system** (`var(--bg-page)` etc.) — the tracking/status screen was the last converted; verify before assuming full-app dark mode coverage is complete.


## Theme system (new — this app only, not the driver/owner apps)
Full light/dark toggle via CSS custom properties, defined in `src/index.css` under `:root`/`[data-theme="light"]` and `[data-theme="dark"]`. `ThemeContext.jsx` manages state (persisted to `localStorage`, defaults to light). One global toggle lives in the nav bar (both mobile hamburger bar and desktop tab row) — not per-screen; don't add another one to an individual screen. When styling anything in this app, use `var(--bg-page)`, `var(--text-primary)`, `var(--accent)` etc. instead of hardcoded hex, so it responds to the toggle. **Fully converted so far**: nav shell, Promo Codes, Account, booking form (`passenger-booking.jsx`). **Not yet converted**: `passenger-booking-status.jsx` (the live tracking screen) — still shows light-only colors regardless of the toggle. One deliberate exception: the WhatsApp share button keeps its real brand green (`#25D366`) in both themes — that's a fixed brand color, not a themeable UI color.

## The single most important file-size fact
`App.jsx` is ~1,500 lines — the largest file across all three apps, and the main file, so a lot of tasks touch it. Always point at a specific function/section.

## Navigation
Top: hamburger bar (mobile) / tab row (desktop), both theme-aware. PLUS a fixed bottom nav bar (mobile only) mirroring the same 4 destinations (Book/Track/Promos/Account) as the top row — added for quick thumb access, not a replacement.

## How the "one app, many driver URLs" mechanism works
No per-driver deployment. One app reads `window.location.pathname`, strips it to a slug, looks up `drivers.booking_slug`. `/johns-taxi` and `/naveed-hanif` are the same code, different database row.

## Architecture facts that aren't obvious from the code alone
- **Guest vs. account booking**: guest gets a one-time access token, nothing persists. Real account uses the same two-step pattern as driver signup (`signup-customer` edge function, RLS blocks direct insert).
- **Customer accounts are scoped to one driver** — deliberate, not a bug.
- **Promo codes replace, not stack with**, a driver's standing tariff discount.
- **Referral rewards are percentage-based** (`drivers.referral_reward_percent`, driver-configurable), NOT a flat euro amount — deliberately kept this way rather than building a separate wallet/credit system. The Account screen's referral card (`get-my-referral-code`) shows the real configured percent, never a fabricated flat number.
- **Cash ("pay later") bookings may have zero upfront charge**, if the driver has `deposit_enabled = false` — `FareEstimateScreen.jsx` must check this (`depositEnabled` prop, sourced from `public_driver_profiles.deposit_enabled`) and show accurate messaging/button text, not assume a deposit always applies.
- **Modify Booking is real** (`modify-booking` edge function) — pickup/drop-off/time editable while status is pending/confirmed only, same window as self-cancel. Real route + fare recalculation on every change. Passenger count is NOT editable (doesn't exist as a field anywhere in this app at all — a real, disclosed gap, not an oversight).
- **Server-side re-verification on every write that matters** — never trust a client-side check from moments earlier still holds.

## Hard-won lessons (each a real bug found and fixed)
- Never let a `catch {}` block swallow an error silently — address search looked completely broken when it was actually working; the UI just had no way to show a request had failed.
- A search result's "name" and "address" are different fields — show both; Mapbox's fallback address can be as generic as an Eircode with the actual name (e.g. "Dublin Airport") never displayed.
- `min-w-0`/`flex-1` don't reliably constrain width inside `flex-col` — a long unbroken string can push a mobile layout wider than the viewport unless the container also has explicit `w-full`.
- **A "TEMPORARY, remove once confirmed fixed" debug panel was left permanently visible to every real passenger** (`pollDebug` display + a `VersionBadge`) — same category of bug independently found on the driver app. Both now gated behind `import.meta.env.DEV`. When adding any diagnostic/debug UI, gate it behind DEV from the start, don't rely on remembering to remove it later.
- **`CREATE OR REPLACE FUNCTION` does not replace a function whose parameter list differs** — creates a silent second overload instead, breaking every caller with ambiguous-function errors. This broke live bookings in production. Any function signature change must either match exactly or explicitly `DROP FUNCTION` the old signature first — and check for dependent views/objects before dropping (this one required recreating `public_driver_profiles`, captured from `pg_views` for real, not guessed).

## Before considering any change done
```bash
npm run build
```
(No `tsc` — this app is JS, not TS.)

## Related repos
- Driver app: `Taxi-admin-Dashboard`.
- Owner app: `owner-dashboard` — no public signup, admin accounts added via direct SQL only.
