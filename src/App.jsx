import { useState } from "react";
import { Menu, X } from "lucide-react";
import PassengerBooking from "./passenger-booking.jsx";
import BookingStatus from "./passenger-booking-status.jsx";
import FareEstimateScreen from "./FareEstimateScreen.jsx";
import PaymentScreen from "./PaymentScreen.jsx";
import BookingConfirmedScreen from "./BookingConfirmedScreen.jsx";
import GuestAccountChoice from "./GuestAccountChoice.jsx";
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
            onCreateAccount={() => alert("Would open account creation")}
            onDismiss={() => setScreen("status")}
          />
        )}

        {screen === "status" && <BookingStatus />}

        {screen === "account" && <AccountHistoryScreen />}
      </div>
    </div>
  );
}
