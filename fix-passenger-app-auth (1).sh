#!/bin/bash
set -e

echo 'Wiring real Supabase Auth into the passenger app...'
echo 'IMPORTANT: run fix-passenger-app-realtime.sh FIRST if you have not already.'

echo 'Writing src/customerAuth.js...'
cat > src/customerAuth.js << 'FILE_EOF_0'
import { supabase } from "./supabaseClient";

/**
 * Real Supabase Auth + customers-table wiring for the passenger app.
 *
 * IMPORTANT — matches the platform's core design decision: a customer
 * account is scoped to ONE driver. Signing up through Driver A's app
 * creates a customers row tied to driver A only. The same person
 * signing up later through Driver B's app creates a completely
 * separate, unrelated customers row — this is intentional, not a bug,
 * per the "no shared customer base" decision made earlier.
 *
 * NOT LIVE-TESTED against a real Supabase Auth call — same caveat as
 * the driver-side auth module. Follows the documented Auth API
 * exactly; first real test is an actual signup in a running browser.
 */

export async function signUpCustomer({ email, password, name, phone, driverId }) {
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

  if (authError) {
    return { customerId: null, error: authError.message };
  }
  if (!authData.user) {
    return { customerId: null, error: "Check your email to confirm your account before signing in." };
  }

  const { data: customerRow, error: customerError } = await supabase
    .from("customers")
    .insert({
      user_id: authData.user.id,
      driver_id: driverId,
      name,
      phone,
      email,
    })
    .select("id")
    .single();

  if (customerError) {
    return { customerId: null, error: customerError.message };
  }

  return { customerId: customerRow.id, error: null };
}

export async function signInCustomer(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { customerId: null, error: error.message };
  }

  return { customerId: null, error: null, userId: data.user.id };
}

/**
 * A signed-in customer might have accounts with multiple drivers (each
 * a separate row) — this looks up the one for THIS driver's app
 * specifically, since that's the only context that matters here.
 */
export async function getCustomerForDriver(userId, driverId) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("user_id", userId)
    .eq("driver_id", driverId)
    .single();

  if (error) {
    return { customer: null, error: "No account found with this driver." };
  }

  return { customer: data, error: null };
}

export async function signOutCustomer() {
  await supabase.auth.signOut();
}

FILE_EOF_0

echo 'Writing src/CustomerAuthScreen.jsx...'
cat > src/CustomerAuthScreen.jsx << 'FILE_EOF_1'
import { useEffect, useState } from "react";
import { Mail, Lock, User, ArrowRight, AlertCircle, ArrowLeft } from "lucide-react";
import { signUpCustomer, signInCustomer } from "./customerAuth";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function Field({ icon: Icon, ...props }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-4 py-3"
      style={{ background: "#F0EEE7", boxShadow: "inset 2px 2px 5px rgba(44,44,42,0.14), inset -2px -2px 5px rgba(255,255,255,0.8)" }}
    >
      <Icon size={16} color="#8C8977" />
      <input
        {...props}
        className="w-full bg-transparent text-sm outline-none placeholder:text-[#8C8977]"
        style={{ color: "#2C2C2A" }}
      />
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.driverId - which driver's app this signup belongs to
 * @param {string} props.driverName - shown in the header, e.g. "John's Taxi"
 * @param {function} props.onAuthSuccess - called with { customerId } or { userId } once done
 * @param {function} props.onBack
 */
export default function CustomerAuthScreen({ driverId, driverName, onAuthSuccess, onBack }) {
  useGoogleFont();
  const [mode, setMode] = useState("signup"); // "signup" | "signin"
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage("");
    setSubmitting(true);

    if (mode === "signup") {
      const result = await signUpCustomer({ email, password, name, phone, driverId });
      setSubmitting(false);
      if (result.error) {
        setErrorMessage(result.error);
        return;
      }
      onAuthSuccess?.({ customerId: result.customerId });
    } else {
      const result = await signInCustomer(email, password);
      setSubmitting(false);
      if (result.error) {
        setErrorMessage(result.error);
        return;
      }
      onAuthSuccess?.({ userId: result.userId });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}>
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">{driverName}</div>
        <div className="w-11" />
      </div>

      <div className="mb-1 text-xl" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: "#2C2C2A" }}>
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </div>
      <div className="mb-6 text-sm text-[#5F5E5A]">
        {mode === "signup" ? "Save your trip history and book faster next time." : "Sign in to see your bookings."}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === "signup" && (
          <>
            <Field icon={User} type="text" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
            <Field icon={User} type="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </>
        )}
        <Field icon={Mail} type="email" placeholder="Email address" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field icon={Lock} type="password" placeholder="Password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />

        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
            <AlertCircle size={14} /> {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)", boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)" }}
        >
          {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          {!submitting && <ArrowRight size={15} />}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        className="mt-4 w-full text-center text-xs font-medium text-[#185FA5]"
      >
        {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </div>
  );
}

FILE_EOF_1

echo 'Writing src/App.jsx...'
cat > src/App.jsx << 'FILE_EOF_2'
import { useState } from "react";
import { Menu, X } from "lucide-react";
import PassengerBooking from "./passenger-booking.jsx";
import BookingStatus from "./passenger-booking-status.jsx";
import FareEstimateScreen from "./FareEstimateScreen.jsx";
import PaymentScreen from "./PaymentScreen.jsx";
import BookingConfirmedScreen from "./BookingConfirmedScreen.jsx";
import GuestAccountChoice from "./GuestAccountChoice.jsx";
import CustomerAuthScreen from "./CustomerAuthScreen.jsx";
import AccountHistoryScreen from "./AccountHistoryScreen.jsx";

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

  const currentLabel = SCREENS.find((s) => s.id === screen)?.label;

  function selectScreen(id) {
    setScreen(id);
    setMenuOpen(false);
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
            onConfirm={() => setScreen("payment")}
            onBack={() => setScreen("booking")}
          />
        )}

        {screen === "payment" && (
          <PaymentScreen
            stripePublishableKey={import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY}
            clientSecret={null} // only exists once the create-booking Edge Function has run
            amount={19.64}
            onSuccess={() => setScreen("confirmed")}
          />
        )}

        {screen === "confirmed" && (
          <BookingConfirmedScreen
            pickup={DEMO_PICKUP}
            dropoff={DEMO_DROPOFF}
            scheduledTime={new Date()}
            totalPaid={19.64}
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

FILE_EOF_2

echo 'Staging and committing...'
git add -A
git commit -m 'Wire real Supabase Auth: customer signup, sign-in'

echo 'Pushing to GitHub...'
git push origin main

echo 'Done.'