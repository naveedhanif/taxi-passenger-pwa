import { useState, useEffect } from "react";
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
import { supabase } from "./supabaseClient.js";

// Demo driver id — a real deployment passes the actual driver's id
// from the URL/QR context (e.g. resolved from the booking_slug).
// This must be a real row in the `drivers` table with is_active = true
// AND stripe_connect_onboarded = true, or create-booking will 404/400.
const DEMO_DRIVER_ID = "7707c60e-24cd-4106-9eda-796ba8a3cf12";

// Demo coordinates (Dublin) so FareEstimateScreen has something real to
// call Mapbox with before the passenger has submitted the booking form.
const DEMO_PICKUP = { lat: 53.3418, lng: -6.2603, address: "Grafton Street" };
const DEMO_DROPOFF = { lat: 53.4264, lng: -6.2499, address: "Dublin Airport" };

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

  // Populated when the passenger submits the booking form. Until then,
  // the fare screen falls back to demo pickup/dropoff below.
  const [formSelection, setFormSelection] = useState(null);

  // Real driver data — vehicle shown on the booking card, fare rules
  // used for the estimate. Both come from Supabase, not hardcoded demo
  // values, so the passenger actually sees this driver's real setup.
  const [vehicle, setVehicle] = useState(null);
  const [fareRules, setFareRules] = useState([]);
  const [driverDataError, setDriverDataError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [vehicleRes, fareRulesRes] = await Promise.all([
        supabase
          .from("public_vehicle_profiles")
          .select("make, model, color, seats")
          .eq("driver_id", DEMO_DRIVER_ID)
          .maybeSingle(),
        supabase
          .from("fare_rules")
          .select("id, name, tariff_period, base_rate, per_km_rate, per_minute_rate, minimum_fare, is_active")
          .eq("driver_id", DEMO_DRIVER_ID)
          .eq("is_active", true),
      ]);

      if (cancelled) return;

      if (!vehicleRes.error) setVehicle(vehicleRes.data);
      if (!fareRulesRes.error) setFareRules(fareRulesRes.data ?? []);

      if (vehicleRes.error || fareRulesRes.error || !vehicleRes.data || (fareRulesRes.data ?? []).length === 0) {
        // Surfaced in the UI rather than silently falling back to fake
        // numbers — a driver with no fare rules set can't give an
        // accurate estimate, and that's worth knowing about, not hiding.
        setDriverDataError(
          (fareRulesRes.data ?? []).length === 0
            ? "This driver hasn't set up fare rules yet — fare estimates aren't available."
            : "Couldn't load this driver's details."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleBookingFormSubmit({ pickup, dropoff, date, time }) {
    // pickup/dropoff arrive already geocoded ({lat, lng, address}) — the
    // booking form resolves them via Mapbox before calling onSubmit.
    setFormSelection({ pickup, dropoff, scheduledTime: new Date(`${date}T${time}`) });
    setScreen("fare");
  }

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
        {driverDataError && (
          <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FCEBEB", color: "#791F1F" }}>
            <AlertCircle size={16} /> {driverDataError}
          </div>
        )}

        {screen === "booking" && (
          <PassengerBooking
            onSubmit={handleBookingFormSubmit}
            mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN}
            vehicle={vehicle}
          />
        )}

        {screen === "fare" && (
          <FareEstimateScreen
            mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN}
            pickup={formSelection?.pickup ?? DEMO_PICKUP}
            dropoff={formSelection?.dropoff ?? DEMO_DROPOFF}
            scheduledTime={formSelection?.scheduledTime ?? new Date()}
            fareRules={fareRules}
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
            driverId={DEMO_DRIVER_ID}
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

