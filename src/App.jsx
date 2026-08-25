import { useState, useEffect } from "react";
import { Menu, X, AlertCircle, Loader2 } from "lucide-react";
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

// Fallback coordinates (Dublin) — only used before the passenger has
// submitted the booking form, so the fare screen has something to
// initially render with.
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

  // Resolved once on load from the URL slug — this IS the multi-tenant
  // routing mechanism. null while resolving, "not_found" if the slug
  // doesn't match any active driver.
  const [driverId, setDriverId] = useState(null);
  const [driverLookupStatus, setDriverLookupStatus] = useState("loading"); // loading | found | not_found | no_slug

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
  const [businessName, setBusinessName] = useState("");
  const [vehicle, setVehicle] = useState(null);
  const [fareRules, setFareRules] = useState([]);
  const [driverDataError, setDriverDataError] = useState("");
  const [payLaterDepositAmount, setPayLaterDepositAmount] = useState(5.0);
  const [avgRating, setAvgRating] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);
  // Live availability — a driver with an active trip is hidden from new
  // bookings. This is a UX convenience (skip the wasted trip through the
  // form); create-booking re-checks this server-side regardless, since
  // this read can go stale between page-load and submit.
  const [isDriverAvailable, setIsDriverAvailable] = useState(true);

  // Step 1: resolve the URL path (e.g. /johns-taxi) to a real driver id
  // via booking_slug. This is what makes one deployed app work for every
  // driver — the slug in the URL decides who the passenger is booking.
  useEffect(() => {
    const slug = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (!slug) {
      setDriverLookupStatus("no_slug");
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("public_driver_profiles")
        .select("id, business_name")
        .eq("booking_slug", slug)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        setDriverLookupStatus("not_found");
        return;
      }

      setDriverId(data.id);
      setBusinessName(data.business_name || "");
      setDriverLookupStatus("found");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Step 2: once we know the driver, load their vehicle/fare/availability
  // and keep it live-updated.
  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;

    async function loadDriverData() {
      const [vehicleRes, fareRulesRes, profileRes] = await Promise.all([
        supabase
          .from("public_vehicle_profiles")
          .select("make, model, color, seats")
          .eq("driver_id", driverId)
          .maybeSingle(),
        supabase
          .from("public_fare_rules")
          .select("id, name, tariff_period, base_rate, per_km_rate, per_minute_rate, minimum_fare, tariff_a_cap, tariff_b_per_km_rate, tariff_b_per_minute_rate, discount_percent, is_active")
          .eq("driver_id", driverId)
          .eq("is_active", true),
        supabase
          .from("public_driver_profiles")
          .select("is_available, pay_later_deposit_amount, avg_rating, review_count")
          .eq("id", driverId)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      if (!vehicleRes.error) setVehicle(vehicleRes.data);
      if (!fareRulesRes.error) setFareRules(fareRulesRes.data ?? []);
      if (!profileRes.error && profileRes.data) {
        setIsDriverAvailable(profileRes.data.is_available);
        setPayLaterDepositAmount(Number(profileRes.data.pay_later_deposit_amount ?? 5));
        setAvgRating(profileRes.data.avg_rating != null ? Number(profileRes.data.avg_rating) : null);
        setReviewCount(Number(profileRes.data.review_count ?? 0));
      }

      if (vehicleRes.error || fareRulesRes.error || !vehicleRes.data || (fareRulesRes.data ?? []).length === 0) {
        // Surfaced in the UI rather than silently falling back to fake
        // numbers — a driver with no fare rules set can't give an
        // accurate estimate, and that's worth knowing about, not hiding.
        setDriverDataError(
          (fareRulesRes.data ?? []).length === 0
            ? "This driver hasn't set up fare rules yet — fare estimates aren't available."
            : "Couldn't load this driver's details."
        );
      } else {
        setDriverDataError("");
      }
    }

    loadDriverData();

    // Live updates: if the driver changes their vehicle, fare rules
    // (incl. discount), or goes busy/free with a new booking, passengers
    // already on this page see it immediately — no refresh needed.
    // Re-fetches everything together on any change rather than trying to
    // patch individual fields, since that's simpler and none of these
    // tables change at high frequency.
    const channel = supabase
      .channel(`passenger-driver-data-${driverId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicles", filter: `driver_id=eq.${driverId}` },
        () => loadDriverData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fare_rules", filter: `driver_id=eq.${driverId}` },
        () => loadDriverData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `driver_id=eq.${driverId}` },
        () => loadDriverData()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  function handleBookingFormSubmit({ passengerName, passengerPhone, passengerEmail, pickup, dropoff, date, time }) {
    // pickup/dropoff arrive already geocoded ({lat, lng, address}) — the
    // booking form resolves them via Mapbox before calling onSubmit.
    setFormSelection({ passengerName, passengerPhone, passengerEmail, pickup, dropoff, scheduledTime: new Date(`${date}T${time}`) });
    setScreen("fare");
  }

  const currentLabel = SCREENS.find((s) => s.id === screen)?.label;

  function selectScreen(id) {
    setScreen(id);
    setMenuOpen(false);
  }

  async function handleConfirmFare({ paymentTiming } = {}) {
    setBookingError("");
    setCreatingBooking(true);

    const result = await createBooking({
      driverId,
      passengerName: formSelection?.passengerName || "",
      passengerPhone: formSelection?.passengerPhone || "",
      passengerEmail: formSelection?.passengerEmail || null,
      pickup: formSelection?.pickup ?? DEMO_PICKUP,
      dropoff: formSelection?.dropoff ?? DEMO_DROPOFF,
      scheduledTime: formSelection?.scheduledTime ?? new Date(),
      paymentTiming: paymentTiming || "now",
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

  // ---- Slug resolution gate: nothing below renders until we know which
  // driver this visit is for. ----
  if (driverLookupStatus === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F5] text-sm text-[#5F5E5A]">
        <Loader2 size={18} className="mr-2 animate-spin" /> Loading…
      </div>
    );
  }

  if (driverLookupStatus === "no_slug") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#F7F7F5] p-6 text-center">
        <div className="text-base font-semibold text-[#2C2C2A]">No driver specified</div>
        <div className="max-w-sm text-sm text-[#5F5E5A]">
          This link needs a driver's booking page — e.g.{" "}
          <code className="rounded bg-[#F0EEE7] px-1.5 py-0.5 text-xs">yoursite.com/johns-taxi</code>.
          Ask your driver for their QR code or booking link.
        </div>
      </div>
    );
  }

  if (driverLookupStatus === "not_found") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#F7F7F5] p-6 text-center">
        <AlertCircle size={22} className="text-[#791F1F]" />
        <div className="text-base font-semibold text-[#2C2C2A]">Driver not found</div>
        <div className="max-w-sm text-sm text-[#5F5E5A]">
          This booking link doesn't match an active driver. Double-check the link or QR code with your driver.
        </div>
      </div>
    );
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

        {!isDriverAvailable && !driverDataError && screen === "booking" && (
          <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FAEEDA", color: "#633806" }}>
            <AlertCircle size={16} /> This driver is currently on a trip. You can still book — they'll pick you up once free — or check back shortly.
          </div>
        )}

        {screen === "booking" && (
          <PassengerBooking
            onSubmit={handleBookingFormSubmit}
            mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN}
            vehicle={vehicle}
            businessName={businessName}
            avgRating={avgRating}
            reviewCount={reviewCount}
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
            payLaterDepositAmount={payLaterDepositAmount}
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
            amount={bookingResult.paymentTiming === "later" ? bookingResult.depositAmount : bookingResult.fare.total}
            paymentTiming={bookingResult.paymentTiming}
            balanceDue={bookingResult.balanceDue}
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
            totalPaid={bookingResult?.paymentTiming === "later" ? bookingResult?.depositAmount ?? 0 : bookingResult?.fare?.total ?? 0}
            balanceDue={bookingResult?.paymentTiming === "later" ? bookingResult?.balanceDue : null}
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
            driverId={driverId}
            driverName={businessName}
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

