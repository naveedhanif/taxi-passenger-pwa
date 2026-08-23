#!/bin/bash
set -e

echo 'Wiring the real booking flow (Edge Function call) into the passenger app...'
echo 'IMPORTANT: run fix-passenger-app-realtime.sh and fix-passenger-app-auth.sh FIRST.'

echo 'Writing src/bookingApi.js...'
cat > src/bookingApi.js << 'FILE_EOF_0'
/**
 * Calls the create-booking Edge Function — the ONLY way a booking
 * should ever be created. The client sends what the passenger typed;
 * the server independently recalculates the real route and fare and
 * ignores anything the client claims about pricing. See
 * supabase/functions/create-booking/index.ts for the server side.
 *
 * NOT LIVE-TESTED — this needs the Edge Function actually deployed
 * (`supabase functions deploy create-booking`) before this call does
 * anything but fail. Written to match Supabase's documented Edge
 * Function invocation pattern exactly.
 *
 * @param {object} params
 * @param {string} params.driverId
 * @param {string} params.passengerName
 * @param {string} params.passengerPhone
 * @param {{address:string, lat:number, lng:number}} params.pickup
 * @param {{address:string, lat:number, lng:number}} params.dropoff
 * @param {Date} params.scheduledTime
 * @param {string|null} params.accessToken - the signed-in user's Supabase session token, if any; omit for guest bookings
 * @returns {Promise<{bookingId, accessToken, clientSecret, fare, distanceKm, durationMinutes, tariffPeriod} | {error: string}>}
 */
export async function createBooking({ driverId, passengerName, passengerPhone, pickup, dropoff, scheduledTime, accessToken }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/functions/v1/create-booking`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Guests use the anon key; a signed-in customer's own session
      // token takes priority so the Edge Function can resolve their
      // real customer_id instead of treating them as a guest.
      Authorization: `Bearer ${accessToken || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      driver_id: driverId,
      passenger_name: passengerName,
      passenger_phone: passengerPhone,
      pickup_address: pickup.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_address: dropoff.address,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      scheduled_time: scheduledTime.toISOString(),
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { error: data.error || "Something went wrong creating your booking" };
  }

  return data;
}

FILE_EOF_0

echo 'Writing src/App.jsx...'
cat > src/App.jsx << 'FILE_EOF_1'
import { useState } from "react";
import { Menu, X, AlertCircle } from "lucide-react";
import PassengerBooking from "./passenger-booking.jsx";
import BookingStatus from "./passenger-booking-status.jsx";
import FareEstimateScreen from "./FareEstimateScreen.jsx";
import PaymentScreen from "./PaymentScreen.jsx";
import BookingConfirmedScreen from "./BookingConfirmedScreen.jsx";
import GuestAccountChoice from "./GuestAccountChoice.jsx";
import CustomerAuthScreen from "./CustomerAuthScreen.jsx";
import AccountHistoryScreen from "./AccountHistoryScreen.jsx";
import { createBooking } from "./bookingApi.js";

// Demo driver id — a real deployment passes the actual driver's id
// from the URL/QR context (e.g. resolved from the booking_slug).
const DEMO_DRIVER_ID = "00000000-0000-0000-0000-000000000000";

// Demo coordinates (Dublin) so FareEstimateScreen has something real to
// call Mapbox with once VITE_MAPBOX_TOKEN is set.
const DEMO_PICKUP = { lat: 53.3418, lng: -6.2603, address: "Grafton Street" };
const DEMO_DROPOFF = { lat: 53.4264, lng: -6.2499, address: "Dublin Airport" };
const DEMO_FARE_RULES = [
  { id: "1", name: "Standard", tariff_period: "standard", base_rate: 4.4, per_km_rate: 1.32, per_minute_rate: 0.47, minimum_fare: 0, is_active: true },
];

const SCREENS = [
  { id: "booking", label: "1. Booking form" },
  { id: "fare", label: "2. Fare estimate" },
  { id: "payment", label: "3. Payment" },
  { id: "confirmed", label: "4. Confirmed" },
  { id: "guest-choice", label: "5. Guest/account" },
  { id: "auth", label: "5b. Sign up/in" },
  { id: "status", label: "6. Live tracking" },
  { id: "account", label: "7. Account/history" },
];

export default function App() {
  const [screen, setScreen] = useState("booking");
  const [menuOpen, setMenuOpen] = useState(false);

  // Real booking state — populated by the actual Edge Function response,
  // not demo data. bookingResult is null until createBooking succeeds.
  const [bookingResult, setBookingResult] = useState(null);
  const [bookingError, setBookingError] = useState("");
  const [creatingBooking, setCreatingBooking] = useState(false);

  const currentLabel = SCREENS.find((s) => s.id === screen)?.label;

  function selectScreen(id) {
    setScreen(id);
    setMenuOpen(false);
  }

  async function handleConfirmFare() {
    setBookingError("");
    setCreatingBooking(true);

    const result = await createBooking({
      driverId: DEMO_DRIVER_ID,
      passengerName: "Sarah Kelly",
      passengerPhone: "+353 87 123 4567",
      pickup: DEMO_PICKUP,
      dropoff: DEMO_DROPOFF,
      scheduledTime: new Date(),
      accessToken: null, // null = guest booking; pass a real session token for signed-in customers
    });

    setCreatingBooking(false);

    if (result.error) {
      setBookingError(result.error);
      return;
    }

    setBookingResult(result);
    setScreen("payment");
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5]">
      {/* Dev-only nav — not part of the real app, just for local testing */}

      {/* Mobile: hamburger bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-[#ECE9E0] bg-[#F7F7F5]/95 px-4 py-3 backdrop-blur-md sm:hidden">
        <span className="text-sm font-semibold text-[#2C2C2A]">{currentLabel}</span>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle screen menu"
          className="flex h-11 w-11 items-center justify-center rounded-lg"
          style={{ background: "#F0EEE7", color: "#2C2C2A" }}
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {menuOpen && (
        <div className="sticky top-[57px] z-30 flex flex-col gap-2 border-b border-[#ECE9E0] bg-[#F7F7F5] p-3 sm:hidden">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              onClick={() => selectScreen(s.id)}
              className="rounded-lg px-4 py-3.5 text-left text-sm font-medium"
              style={{
                background: screen === s.id ? "#185FA5" : "#F0EEE7",
                color: screen === s.id ? "#FFFFFF" : "#5F5E5A",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Desktop / tablet: row of tabs */}
      <div className="sticky top-0 z-40 hidden flex-wrap justify-center gap-2.5 border-b border-[#ECE9E0] bg-[#F7F7F5]/90 p-4 backdrop-blur-md sm:flex">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            onClick={() => setScreen(s.id)}
            className="rounded-lg px-4 py-2.5 text-sm font-medium"
            style={{
              background: screen === s.id ? "#185FA5" : "#F0EEE7",
              color: screen === s.id ? "#FFFFFF" : "#5F5E5A",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="py-6">
        {screen === "booking" && <PassengerBooking />}

        {screen === "fare" && (
          <FareEstimateScreen
            mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN}
            pickup={DEMO_PICKUP}
            dropoff={DEMO_DROPOFF}
            scheduledTime={new Date()}
            fareRules={DEMO_FARE_RULES}
            preBookingFee={3.0}
            onConfirm={handleConfirmFare}
            onBack={() => setScreen("booking")}
          />
        )}

        {creatingBooking && (
          <div className="mx-auto flex w-full max-w-[400px] flex-col items-center gap-3 p-10 text-center text-sm text-[#5F5E5A]">
            Creating your booking…
          </div>
        )}

        {bookingError && !creatingBooking && (
          <div className="mx-auto flex w-full max-w-[400px] items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FCEBEB", color: "#791F1F" }}>
            <AlertCircle size={16} /> {bookingError}
          </div>
        )}

        {screen === "payment" && bookingResult && (
          <PaymentScreen
            stripePublishableKey={import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY}
            clientSecret={bookingResult.clientSecret}
            amount={bookingResult.fare.total}
            onSuccess={() => setScreen("confirmed")}
          />
        )}

        {screen === "payment" && !bookingResult && !creatingBooking && (
          <div className="mx-auto w-full max-w-[400px] p-10 text-center text-sm text-[#8C8977]">
            No booking yet — go through "2. Fare estimate" and tap "Confirm & pay" first.
          </div>
        )}

        {screen === "confirmed" && (
          <BookingConfirmedScreen
            pickup={DEMO_PICKUP}
            dropoff={DEMO_DROPOFF}
            scheduledTime={new Date()}
            totalPaid={bookingResult?.fare?.total ?? 0}
            onViewBooking={() => setScreen("status")}
          />
        )}

        {screen === "guest-choice" && (
          <GuestAccountChoice
            onCreateAccount={() => setScreen("auth")}
            onDismiss={() => setScreen("status")}
          />
        )}

        {screen === "auth" && (
          <CustomerAuthScreen
            driverId="00000000-0000-0000-0000-000000000000" // demo only — real app passes the actual driver's id from context
            driverName="John's Taxi"
            onAuthSuccess={() => setScreen("account")}
            onBack={() => setScreen("guest-choice")}
          />
        )}

        {screen === "status" && <BookingStatus />}

        {screen === "account" && <AccountHistoryScreen />}
      </div>
    </div>
  );
}

FILE_EOF_1

echo 'Staging and committing...'
git add -A
git commit -m 'Wire real booking flow: calls create-booking Edge Function, real Stripe clientSecret'

echo 'Pushing to GitHub...'
git push origin main

echo 'Done.'