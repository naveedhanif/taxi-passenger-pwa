import { useState, useEffect, useRef, useCallback } from "react";
import { Menu, X, AlertCircle, Loader2, ArrowLeft, Home as HomeIcon, CheckCircle2 } from "lucide-react";
import PassengerBooking from "./passenger-booking.jsx";
import BookingStatus from "./passenger-booking-status.jsx";
import FareEstimateScreen from "./FareEstimateScreen.jsx";
import PaymentScreen from "./PaymentScreen.jsx";
import BookingConfirmedScreen from "./BookingConfirmedScreen.jsx";
import GuestAccountChoice from "./GuestAccountChoice.jsx";
import CustomerAuthScreen from "./CustomerAuthScreen.jsx";
import AccountHistoryScreen from "./AccountHistoryScreen.jsx";
import DriverProfileScreen from "./DriverProfileScreen.jsx";
import { createBooking } from "./bookingApi.js";
import { getBookingStatus } from "./bookingStatusApi.js";
import { getCustomerForDriver, signOutCustomer, ensureCustomerRecord } from "./customerAuth.js";
import { getCustomerBookings } from "./customerBookingsApi.js";
import { supabase } from "./supabaseClient.js";
import { getDriverOnlineStatus, getDriverPhotos } from "./driverAvailabilityApi.js";
import { listSavedLocations, addSavedLocation, deleteSavedLocation } from "./savedLocationsApi.js";
import { listRecurringRides, addRecurringRide, toggleRecurringRide, deleteRecurringRide } from "./recurringRidesApi.js";
import { getActivePromo } from "./promoApi.js";

// Fallback coordinates (Dublin) — only used before the passenger has
// submitted the booking form, so the fare screen has something to
// initially render with.
const DEMO_PICKUP = { lat: 53.3418, lng: -6.2603, address: "Grafton Street" };
const DEMO_DROPOFF = { lat: 53.4264, lng: -6.2499, address: "Dublin Airport" };

// A normal navigation menu of genuine destinations — not every screen
// belongs here. Fare estimate / Payment / Confirmed are wizard steps
// that only make sense reached through the actual booking flow; jumping
// to them directly always shows an empty placeholder ("No booking yet")
// since there's no in-progress booking behind them, which is exactly
// what looked like a broken/useless page. Only screens meaningful to
// visit on their own are listed here.
const SCREENS = [
  { id: "booking", label: "Book a ride" },
  { id: "status", label: "Live tracking" },
  { id: "account", label: "Account" },
];

function guestBookingStorageKey(driverId) {
  return `taxi_guest_booking_${driverId}`;
}

const STATUS_ALERT_STYLES = {
  success: { background: "#EAF3DE", color: "#27500A", border: "1px solid #CFE3B8" },
  info: { background: "#E6F1FB", color: "#0C447C", border: "1px solid #C3DCF3" },
  error: { background: "#FCEBEB", color: "#791F1F", border: "1px solid #F3C6C6" },
};

export default function App() {
  const [screen, setScreen] = useState("booking");
  const [menuOpen, setMenuOpen] = useState(false);
  // One-level "back" support for sub-screens (status/account/auth) —
  // this app is a flat state-driven screen switcher, not a router, so
  // this just remembers whichever screen was active right before
  // navigating into a sub-screen and returns to exactly that.
  const prevScreenRef = useRef("booking");
  function go(next) {
    prevScreenRef.current = screen;
    setScreen(next);
  }
  function goBack() {
    setScreen(prevScreenRef.current);
  }

  // Resolved once on load from the URL slug — this IS the multi-tenant
  // routing mechanism. null while resolving, "not_found" if the slug
  // doesn't match any active driver.
  const [driverId, setDriverId] = useState(null);
  const [driverLookupStatus, setDriverLookupStatus] = useState("loading"); // loading | found | not_found | no_slug
  // True when this screen was reached via a shared tracking link
  // (?track=bookingId&token=accessToken) rather than by the actual
  // passenger going through the real booking flow — see
  // passenger-booking-status.jsx's "Share trip" button, which builds
  // links in exactly this shape. Tells BookingStatus to hide Cancel/
  // Rate/Tip, since whoever opened a shared link isn't necessarily the
  // real passenger and shouldn't be able to take actions on their
  // behalf.
  const [isSharedView, setIsSharedView] = useState(false);

  // Real booking state — populated by the actual Edge Function response,
  // not demo data. bookingResult is null until createBooking succeeds.
  const [bookingResult, setBookingResult] = useState(null);
  const [bookingError, setBookingError] = useState("");
  const [creatingBooking, setCreatingBooking] = useState(false);

  // Populated when the passenger submits the booking form. Until then,
  // the fare screen falls back to demo pickup/dropoff below.
  const [formSelection, setFormSelection] = useState(null);

  // Lifted booking-form draft — owned here (App stays mounted across
  // screen changes) rather than as local state inside PassengerBooking
  // (which unmounts whenever `screen` changes away from "booking",
  // wiping anything typed). Passed down as controlled props so
  // navigating away (e.g. back from the fare/payment screen) and
  // returning preserves everything the passenger already typed.
  const [bookingDraft, setBookingDraft] = useState({
    passengerName: "",
    passengerPhone: "",
    passengerEmail: "",
    pickup: "",
    dropoff: "",
    pickupCoords: null,
    dropoffCoords: null,
    date: "",
    time: "",
  });

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
  const [licenceVerified, setLicenceVerified] = useState(false);
  const [driverPhoneNumber, setDriverPhoneNumber] = useState(null);
  // Live availability — a driver with an active trip is hidden from new
  // bookings. This is a UX convenience (skip the wasted trip through the
  // form); create-booking re-checks this server-side regardless, since
  // this read can go stale between page-load and submit.
  const [isDriverAvailable, setIsDriverAvailable] = useState(true);
  // Separate from the above: whether the driver has manually marked
  // themselves as taking bookings today at all — a driver who's simply
  // not working today is a different situation from one who's mid-trip
  // right now, and deserves a different message.
  const [isDriverOnline, setIsDriverOnline] = useState(true);
  const [driverPhotoUrl, setDriverPhotoUrl] = useState(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState(null);

  // ---- Real customer session (signed-in passengers) ----
  // Resolved from Supabase Auth, not assumed. Used to (a) pass the real
  // session token into createBooking so the booking actually attaches
  // to this customer's account instead of always being a guest booking,
  // and (b) drive AccountHistoryScreen with real data. authOrigin
  // remembers *why* the passenger went to sign in, so success routes
  // them somewhere sensible instead of always the same place.
  const [customerSession, setCustomerSession] = useState(null); // { userId, accessToken, customer:{id,name,phone,email} } | null
  // { id, code, discountType, discountValue } | null — looked up fresh
  // each time the passenger reaches the fare screen, see the effect
  // below. Display-only; create-booking re-validates it independently.
  const [activePromo, setActivePromo] = useState(null);
  const [resolvingSession, setResolvingSession] = useState(true);
  const authOriginRef = useRef("account"); // "account" | "post-booking"

  const resolveCustomerForSession = useCallback(
    async (session) => {
      if (!session?.user || !driverId) {
        setCustomerSession(null);
        return;
      }
      let { customer } = await getCustomerForDriver(session.user.id, driverId);

      if (!customer) {
        // Self-heal: a real Supabase Auth account with no matching
        // customers row is exactly the limbo state the earlier RLS bug
        // (and the "already registered" foreign-key bug right after
        // it) could leave someone in. Rather than require anyone
        // caught by either bug to somehow know to contact support,
        // just repair it transparently the next time they're signed
        // in — ensureCustomerRecord is idempotent, so this is a no-op
        // for every passenger who was never affected.
        const healResult = await ensureCustomerRecord({
          userId: session.user.id,
          email: session.user.email,
          driverId,
        });
        if (!healResult.error) {
          ({ customer } = await getCustomerForDriver(session.user.id, driverId));
        }
      }

      setCustomerSession({
        userId: session.user.id,
        accessToken: session.access_token,
        customer: customer || null,
      });
    },
    [driverId]
  );

  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      resolveCustomerForSession(data.session).finally(() => setResolvingSession(false));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      resolveCustomerForSession(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [driverId, resolveCustomerForSession]);

  // Auto-fill the booking form with a signed-in customer's real details
  // — previously every passenger had to retype their name/phone/email
  // on every single booking even with an account, since the form never
  // looked at customerSession at all. Only fills in currently-blank
  // fields, so it never overwrites something already typed (e.g. a
  // guest who started filling the form, then signed in mid-way).
  useEffect(() => {
    const c = customerSession?.customer;
    if (!c) return;
    // A self-heal (see resolveCustomerForSession above) that only ever
    // had an email to work with fills `name` with the email's local
    // part as a placeholder. Auto-filling THAT into the form is worse
    // than leaving it blank — it looks like real data, so a passenger
    // has no reason to notice or correct it. Detect and skip it
    // specifically, so the field stays empty and genuinely prompts
    // them to type their real name once.
    const looksLikeEmailPlaceholder = c.email && c.name && c.email.toLowerCase().startsWith(c.name.toLowerCase());
    setBookingDraft((prev) => {
      if (prev.passengerName || prev.passengerPhone || prev.passengerEmail) return prev;
      return {
        ...prev,
        passengerName: looksLikeEmailPlaceholder ? "" : c.name || "",
        passengerPhone: c.phone || "",
        passengerEmail: c.email || "",
      };
    });
  }, [customerSession]);

  // ---- Guest booking persistence ----
  // Without a real router, a page refresh resets `screen` back to
  // "booking" and loses bookingResult from memory — which used to mean
  // a guest who just paid, then refreshed, had no way back to their live
  // tracking page at all. Persisting the essentials (bookingId + the
  // per-booking access_token get-booking-status accepts) to
  // localStorage fixes that for guests; signed-in customers instead
  // reach it via Account → their booking, so they don't need this.
  const [activeGuestBooking, setActiveGuestBooking] = useState(null); // { bookingId, accessToken } | null

  useEffect(() => {
    if (!driverId) return;
    try {
      const raw = localStorage.getItem(guestBookingStorageKey(driverId));
      if (raw) setActiveGuestBooking(JSON.parse(raw));
    } catch {
      // Corrupt/blocked storage — just proceed with no persisted booking.
    }
  }, [driverId]);

  function persistGuestBooking(bookingId, accessToken) {
    if (!driverId) return;
    const value = { bookingId, accessToken };
    setActiveGuestBooking(value);
    try {
      localStorage.setItem(guestBookingStorageKey(driverId), JSON.stringify(value));
    } catch {
      // Ignore storage failures — tracking still works for this session,
      // just won't survive a refresh.
    }
  }

  function clearGuestBooking() {
    setActiveGuestBooking(null);
    if (driverId) {
      try {
        localStorage.removeItem(guestBookingStorageKey(driverId));
      } catch {
        // Ignore.
      }
    }
  }

  // ---- Top-level status-change watcher ----
  // The live tracking screen (passenger-booking-status.jsx) already
  // shows status clearly — but only while the passenger is actually
  // looking at that screen. Previously ONLY cancellation was watched
  // for from outside that screen; a driver confirming, going en route,
  // or arriving produced no notification at all if the passenger was
  // anywhere else (e.g. the main booking screen). This polls
  // independently of `screen` and shows an immediate banner for every
  // meaningful transition, wherever the passenger currently is.
  const STATUS_ALERTS = {
    confirmed: { tone: "info", title: "Booking confirmed", message: "Your driver has confirmed your booking." },
    en_route: { tone: "info", title: "Driver on the way", message: "Your driver is heading to your pickup location." },
    arrived: { tone: "success", title: "Driver has arrived", message: "Your driver is waiting outside." },
    in_progress: { tone: "info", title: "Trip started", message: "Your trip is now in progress." },
    completed: { tone: "success", title: "Trip completed", message: "Thanks for riding — hope it went well!" },
    canceled: { tone: "error", title: "Booking cancelled", message: null }, // message filled in from refund status below
  };
  const [statusAlert, setStatusAlert] = useState(null); // { tone, title, message } | null
  // Passengers previously only got a silent visual banner — no sound at
  // all, unlike the driver side. This is the same idea: a short,
  // gentle chime (distinct from the driver's urgent alert tone, since
  // this is informational rather than action-required) plus a light
  // vibration on mobile.
  const statusAudioRef = useRef(null);
  // TEMPORARY — diagnostic only, see the debug badge near the bottom of
  // this component's render. Tracks exactly what the last poll attempt
  // did, so it can be screenshotted instead of guessed at.
  const [pollDebug, setPollDebug] = useState(null);
  const lastKnownStatusRef = useRef(null);
  const statusInitializedRef = useRef(false);
  // screen and customerSession both change on nearly every render/
  // navigation — if the polling effect depended on them directly, every
  // navigation tore down and recreated the interval, so the real 10s
  // timer rarely got a chance to actually elapse. That's what caused
  // "only the first notification arrived and never any after it" — not
  // every restart happened to catch a transition. Reading current
  // values from refs at poll time instead means the interval is set up
  // ONCE per real booking and ticks reliably regardless of navigation.
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  const customerSessionRef = useRef(customerSession);
  useEffect(() => {
    customerSessionRef.current = customerSession;
  }, [customerSession]);

  // Unlocks audio playback for mobile browsers — same fix as the driver
  // app. Most mobile browsers (iOS Safari especially) block .play()
  // calls that don't trace back to a genuine user tap; a status change
  // arriving via poll/Realtime doesn't count as one. Priming the
  // element with a real play()+immediate pause() inside the very first
  // tap anywhere on the page satisfies that once, after which
  // programmatic play() calls succeed for the rest of the session.
  useEffect(() => {
    function unlockAudio() {
      const audio = statusAudioRef.current;
      if (audio) {
        audio
          .play()
          .then(() => {
            audio.pause();
            audio.currentTime = 0;
          })
          .catch(() => {
            // Will simply try again on the next tap.
          });
      }
    }
    document.addEventListener("click", unlockAudio, { once: true });
    document.addEventListener("touchstart", unlockAudio, { once: true });
    return () => {
      document.removeEventListener("click", unlockAudio);
      document.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  const trackedBookingId = bookingResult?.bookingId ?? activeGuestBooking?.bookingId;
  const trackedGuestAccessToken = bookingResult?.accessToken ?? activeGuestBooking?.accessToken;

  useEffect(() => {
    if (!trackedBookingId) {
      statusInitializedRef.current = false;
      return;
    }

    // Recover the last-seen status from a previous page load, if any —
    // this is what lets a genuine transition still be detected even
    // when the reload itself happens right at/after the moment it
    // occurred. Without this, statusInitializedRef always started
    // false on every fresh mount, so the very first poll after ANY
    // reload silently adopted whatever status it found as the new
    // baseline instead of recognizing it as a real change — losing
    // the notification entirely if a reload happened to land after
    // the driver's action but before the passenger had seen it.
    const storageKey = `taxi_last_seen_status_${trackedBookingId}`;
    try {
      const persisted = localStorage.getItem(storageKey);
      if (persisted) {
        lastKnownStatusRef.current = persisted;
        statusInitializedRef.current = true;
      }
    } catch {
      // Ignore — falls back to the original "treat first poll as
      // baseline" behavior, which is still correct for a genuinely
      // first-ever check.
    }

    let cancelledEffect = false;
    async function poll() {
      const cs = customerSessionRef.current;
      // Same reasoning as the BookingStatus prop below — never null this
      // out just because the passenger happens to be signed in right
      // now. See that comment for the full explanation.
      const guestAccessToken = trackedGuestAccessToken ?? null;
      const customerSessionToken = cs?.accessToken || null;

      const result = await getBookingStatus({ bookingId: trackedBookingId, guestAccessToken, customerSessionToken });

      if (cancelledEffect) return;

      if (result.error) {
        setPollDebug({
          time: new Date().toLocaleTimeString(),
          bookingId: trackedBookingId,
          authMode: cs?.customer ? "customer session" : "guest token",
          hasGuestToken: Boolean(guestAccessToken),
          hasCustomerToken: Boolean(customerSessionToken),
          error: result.error,
        });
        return;
      }

      const newStatus = result.booking.status;
      const previousStatus = lastKnownStatusRef.current;
      setPollDebug({
        time: new Date().toLocaleTimeString(),
        bookingId: trackedBookingId,
        authMode: cs?.customer ? "customer session" : "guest token",
        status: newStatus,
        previousStatus,
        initialized: statusInitializedRef.current,
        onStatusScreen: screenRef.current === "status",
      });
      lastKnownStatusRef.current = newStatus;
      try {
        localStorage.setItem(storageKey, newStatus);
      } catch {
        // Ignore — this reload-recovery is a nice-to-have, not required
        // for the current session's own polling to keep working.
      }

      // Skip alerting on the very first read for this booking — that's
      // just establishing a baseline, not a transition the passenger
      // actually witnessed happen. Deliberately NOT excluded based on
      // which screen is currently showing — a quiet inline update on
      // the live tracking screen isn't a real notification on its own;
      // the banner fires everywhere, including there.
      if (statusInitializedRef.current && newStatus !== previousStatus) {
        const alertContent = STATUS_ALERTS[newStatus];
        if (alertContent) {
          setStatusAlert(
            newStatus === "canceled"
              ? {
                  ...alertContent,
                  message: result.booking.refunded
                    ? "Your refund is on the way — it can take a few days to appear on your statement."
                    : "Contact your driver if you were expecting a refund.",
                }
              : alertContent
          );
          // Reset playback position before every play() call. Without
          // this, calling .play() on an <audio> element that's already
          // finished playing is a silent no-op in many browsers — there's
          // nothing left to play from the end position. This is exactly
          // why only the very first notification's sound worked: the
          // banner logic above fires correctly on every real transition,
          // but every play() after the first one was hitting an element
          // still sitting at its own end, not actually restarting.
          const audio = statusAudioRef.current;
          if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {
              // Blocked until the passenger has interacted with the page
              // at least once — see the unlock effect below, which
              // primes this the same way the driver app does.
            });
          }
          if ("vibrate" in navigator) {
            try {
              navigator.vibrate(80);
            } catch {
              // Not supported on this device/browser — ignore.
            }
          }
        }
      }
      statusInitializedRef.current = true;

      if (["completed", "canceled"].includes(newStatus)) {
        clearInterval(intervalId);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // Ignore.
        }
      }
    }

    poll();
    // Deliberately a bit slower than the live tracking screen's own 8s
    // poll — this is a background watcher, not the primary status
    // display, but still fast enough to feel close to real-time. Kept
    // running even with Realtime below as a fallback: if the
    // subscription silently receives nothing (e.g. an RLS policy that
    // doesn't cover a particular guest path), this is what still
    // delivers the update, just with up to 10s of latency instead of
    // near-instant.
    const intervalId = setInterval(poll, 10000);

    // Realtime: the fast path. The moment Postgres reports a change to
    // this exact booking row, poll immediately instead of waiting for
    // the next scheduled tick — this is what closes the biggest real
    // gap versus Uber/Bolt, which push status changes instantly rather
    // than on a delay. Deliberately reuses poll() (the same authorized
    // get-booking-status call) instead of trying to reconstruct the
    // full alert-ready response from the raw postgres_changes payload
    // — that payload doesn't include the driver/vehicle/refund info
    // the banner needs anyway, and reusing one code path means there's
    // only one place auth/shaping logic can go wrong.
    const channel = supabase
      .channel(`booking-status-${trackedBookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${trackedBookingId}` },
        () => {
          poll();
        }
      )
      .subscribe();

    return () => {
      cancelledEffect = true;
      clearInterval(intervalId);
      supabase.removeChannel(channel);
    };
  }, [trackedBookingId, trackedGuestAccessToken]);

  // ---- Account history (signed-in customers only — see customerAuth.js:
  // an account is scoped to one driver, so there's no cross-driver
  // history to show) ----
  const [accountBookings, setAccountBookings] = useState([]);
  const [accountError, setAccountError] = useState("");
  const [loadingAccount, setLoadingAccount] = useState(false);

  async function loadAccountHistory() {
    if (!customerSession?.accessToken || !driverId) return;
    setLoadingAccount(true);
    const result = await getCustomerBookings({ driverId, customerSessionToken: customerSession.accessToken });
    setLoadingAccount(false);
    if (result.error) {
      setAccountError(result.error);
      return;
    }
    setAccountError("");
    setAccountBookings(result.bookings || []);
    // The server is the source of truth for the customer's own name/
    // phone/email — refresh it here too in case it was edited elsewhere.
    setCustomerSession((prev) => (prev ? { ...prev, customer: result.customer } : prev));
  }

  useEffect(() => {
    if (screen === "account") loadAccountHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // ---- Saved locations (Home/Work etc, signed-in customers only) ----
  // AccountHistoryScreen already had the UI for this; App.jsx just
  // never fed it real data before now. Loaded whenever a signed-in
  // customer resolves — not just when the account screen opens — so
  // the booking form's quick-select chips have data ready too.
  const [savedLocations, setSavedLocations] = useState([]);

  async function loadSavedLocations() {
    if (!customerSession?.accessToken || !driverId) return;
    const result = await listSavedLocations({ driverId, customerSessionToken: customerSession.accessToken });
    if (!result.error) setSavedLocations(result.locations || []);
  }

  useEffect(() => {
    if (customerSession?.customer) loadSavedLocations();
    else setSavedLocations([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSession?.customer, driverId]);

  async function handleSaveLocation({ label, address, lat, lng }) {
    if (!customerSession?.accessToken || !driverId) return;
    const result = await addSavedLocation({ driverId, customerSessionToken: customerSession.accessToken, label, address, lat, lng });
    if (!result.error) loadSavedLocations();
  }

  async function handleDeleteLocation(locationId) {
    if (!customerSession?.accessToken || !driverId) return;
    const result = await deleteSavedLocation({ driverId, customerSessionToken: customerSession.accessToken, locationId });
    if (!result.error) setSavedLocations((prev) => prev.filter((l) => l.id !== locationId));
  }

  // ---- Recurring ride templates (signed-in customers only) ----
  // These are TEMPLATES, not automatically-charged bookings — see
  // manage-recurring-rides/index.ts for why genuine unattended billing
  // isn't built here. A matching day just shows a one-tap banner that
  // pre-fills the booking form; the passenger still confirms and pays
  // every time, same as any other booking.
  const [recurringRides, setRecurringRides] = useState([]);

  async function loadRecurringRides() {
    if (!customerSession?.accessToken || !driverId) return;
    const result = await listRecurringRides({ driverId, customerSessionToken: customerSession.accessToken });
    if (!result.error) setRecurringRides(result.rides || []);
  }

  useEffect(() => {
    if (customerSession?.customer) loadRecurringRides();
    else setRecurringRides([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSession?.customer, driverId]);

  async function handleAddRecurringRide({ label, pickup, dropoff, daysOfWeek, timeOfDay }) {
    if (!customerSession?.accessToken || !driverId) return { error: "Not signed in" };
    const result = await addRecurringRide({ driverId, customerSessionToken: customerSession.accessToken, label, pickup, dropoff, daysOfWeek, timeOfDay });
    if (!result.error) loadRecurringRides();
    return result;
  }

  async function handleToggleRecurringRide(rideId, active) {
    if (!customerSession?.accessToken || !driverId) return;
    const result = await toggleRecurringRide({ driverId, customerSessionToken: customerSession.accessToken, rideId, active });
    if (!result.error) setRecurringRides((prev) => prev.map((r) => (r.id === rideId ? { ...r, active } : r)));
  }

  async function handleDeleteRecurringRide(rideId) {
    if (!customerSession?.accessToken || !driverId) return;
    const result = await deleteRecurringRide({ driverId, customerSessionToken: customerSession.accessToken, rideId });
    if (!result.error) setRecurringRides((prev) => prev.filter((r) => r.id !== rideId));
  }

  // Today's matching active recurring ride, if any — the banner on the
  // main booking screen just checks "does today's day-of-week appear in
  // this ride's days_of_week", not an exact time window, so it's
  // visible any time that day rather than only right at the scheduled
  // moment.
  const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayMatchingRide = recurringRides.find((r) => r.active && (r.days_of_week || []).includes(todayKey));

  function handleUseRecurringRide(ride) {
    setBookingDraft((prev) => ({
      ...prev,
      pickup: ride.pickup_address,
      pickupCoords: { lat: ride.pickup_lat, lng: ride.pickup_lng, fullAddress: ride.pickup_address },
      dropoff: ride.dropoff_address,
      dropoffCoords: { lat: ride.dropoff_lat, lng: ride.dropoff_lng, fullAddress: ride.dropoff_address },
      date: new Date().toISOString().slice(0, 10),
      time: ride.time_of_day,
    }));
  }

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

      // Shared trip link — see passenger-booking-status.jsx's "Share
      // trip" button, which builds a link in exactly this shape. Reuses
      // the same bookingResult/status-screen mechanism a real booking
      // already uses; isSharedView just tells BookingStatus to hide
      // Cancel/Rate/Tip, since whoever opened this link isn't
      // necessarily the actual passenger.
      const params = new URLSearchParams(window.location.search);
      const trackId = params.get("track");
      const trackToken = params.get("token");
      if (trackId && trackToken) {
        setBookingResult({ bookingId: trackId, accessToken: trackToken, paymentTiming: null, fare: null });
        setIsSharedView(true);
        go("status");
      }
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
      const [vehicleRes, fareRulesRes, profileRes, onlineStatus, photos] = await Promise.all([
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
          .select("is_available, pay_later_deposit_amount, avg_rating, review_count, licence_verified, phone_number")
          .eq("id", driverId)
          .maybeSingle(),
        getDriverOnlineStatus(driverId),
        getDriverPhotos(driverId),
      ]);

      if (cancelled) return;

      setIsDriverOnline(onlineStatus);
      setDriverPhotoUrl(photos.driverPhotoUrl);
      setVehiclePhotoUrl(photos.vehiclePhotoUrl);
      if (!vehicleRes.error) setVehicle(vehicleRes.data);
      if (!fareRulesRes.error) setFareRules(fareRulesRes.data ?? []);
      if (!profileRes.error && profileRes.data) {
        setIsDriverAvailable(profileRes.data.is_available);
        setPayLaterDepositAmount(Number(profileRes.data.pay_later_deposit_amount ?? 5));
        setAvgRating(profileRes.data.avg_rating != null ? Number(profileRes.data.avg_rating) : null);
        setReviewCount(Number(profileRes.data.review_count ?? 0));
        setLicenceVerified(Boolean(profileRes.data.licence_verified));
        setDriverPhoneNumber(profileRes.data.phone_number ?? null);
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

  async function handleBookingFormSubmit({ passengerName, passengerPhone, passengerEmail, pickup, dropoff, stops, date, time }) {
    // pickup/dropoff arrive already geocoded ({lat, lng, address}) — the
    // booking form resolves them via Mapbox before calling onSubmit.
    const scheduledTime = new Date(`${date}T${time}`);

    // Re-check availability for the EXACT requested time before moving
    // on — driverId's "is_available" from the loaded profile only
    // reflects "available right now", which isn't accurate once the
    // passenger has picked a specific future time. This is a real
    // time-overlap check (is_driver_available_at), same one
    // create-booking uses as the final gate — this earlier check just
    // gives the passenger a faster, friendlier "pick a different time"
    // instead of discovering the conflict after filling in payment.
    setBookingError("");
    const { data: isAvailableAtTime, error: availabilityError } = await supabase.rpc(
      "is_driver_available_at",
      { p_driver_id: driverId, p_requested_time: scheduledTime.toISOString() }
    );

    if (availabilityError) {
      // Fail open here — don't block the passenger over a transient
      // network hiccup on a courtesy pre-check. create-booking still
      // enforces the real gate server-side regardless.
      console.error("Availability pre-check failed:", availabilityError);
    } else if (isAvailableAtTime === false) {
      setBookingError("This driver already has a booking around that time — please choose a different time.");
      return;
    }

    setFormSelection({ passengerName, passengerPhone, passengerEmail, pickup, dropoff, stops: stops || [], scheduledTime });
    go("fare");
  }

  // Refreshed every time the passenger reaches the fare screen (not
  // just once on mount) so a promo that's created/toggled while
  // they're mid-booking still gets picked up, and so a stale one from
  // an earlier visit doesn't linger.
  useEffect(() => {
    if (screen !== "fare" || !driverId) return;
    let cancelled = false;
    (async () => {
      const result = await getActivePromo({ driverId, customerSessionToken: customerSession?.accessToken || null });
      if (!cancelled) setActivePromo(result?.promo ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, driverId, customerSession?.accessToken]);

  const currentLabel = SCREENS.find((s) => s.id === screen)?.label;

  function selectScreen(id) {
    go(id);
    setMenuOpen(false);
  }

  async function handleConfirmFare({ paymentTiming, promoCodeId } = {}) {
    setBookingError("");
    setCreatingBooking(true);

    const result = await createBooking({
      driverId,
      passengerName: formSelection?.passengerName || "",
      passengerPhone: formSelection?.passengerPhone || "",
      passengerEmail: formSelection?.passengerEmail || null,
      pickup: formSelection?.pickup ?? DEMO_PICKUP,
      dropoff: formSelection?.dropoff ?? DEMO_DROPOFF,
      stops: formSelection?.stops ?? [],
      scheduledTime: formSelection?.scheduledTime ?? new Date(),
      paymentTiming: paymentTiming || "now",
      // A signed-in customer's real session token — not always null.
      // Without this, create-booking has no way to resolve customer_id
      // and every booking becomes a guest booking regardless of whether
      // the passenger actually has an account, which is why account
      // history could never show real past trips before.
      accessToken: customerSession?.accessToken || null,
      promoCodeId: promoCodeId || null,
    });

    setCreatingBooking(false);

    if (result.error) {
      setBookingError(result.error);
      return;
    }

    setBookingResult(result);
    if (!customerSession?.customer) {
      // Guest (or signed-in-but-no-customer-row-yet) booking — this is
      // the only reliable way back to it after a refresh, since there's
      // no login to fall back on.
      persistGuestBooking(result.bookingId, result.accessToken);
    } else if (formSelection?.passengerName || formSelection?.passengerPhone) {
      // Fire-and-forget: repair the customer's saved profile with
      // whatever real name/phone they just typed, in case it was
      // stuck with a self-heal's email-derived placeholder. Doesn't
      // block or fail the booking if this errors — the booking itself
      // already succeeded above.
      ensureCustomerRecord({
        userId: customerSession.userId,
        email: customerSession.customer.email,
        name: formSelection.passengerName || null,
        phone: formSelection.passengerPhone || null,
        driverId,
      }).then((r) => {
        if (!r.error) {
          setCustomerSession((prev) =>
            prev
              ? {
                  ...prev,
                  customer: {
                    ...prev.customer,
                    name: formSelection.passengerName || prev.customer.name,
                    phone: formSelection.passengerPhone || prev.customer.phone,
                  },
                }
              : prev
          );
        }
      });
    }
    go("payment");
  }

  function handleViewBooking() {
    // Signed-in customers already have a durable way back to this
    // booking (their account), so the "want to save this trip?" prompt
    // — which exists specifically to get a GUEST to create one — would
    // be redundant and confusing to show them. This is the fix for
    // "guest and sign-up look the same": each passenger now only ever
    // sees the ONE flow relevant to their actual state.
    if (customerSession?.customer) {
      go("status");
    } else {
      go("guest-choice");
    }
  }

  function handleAuthSuccess() {
    // resolveCustomerForSession runs automatically via onAuthStateChange
    // once Supabase Auth's session updates, so customerSession will
    // populate itself shortly after this — no need to duplicate that
    // lookup here. Just route back to wherever the passenger meant to
    // end up.
    go(authOriginRef.current === "post-booking" ? "status" : "account");
  }

  async function handleSignOut() {
    await signOutCustomer();
    setCustomerSession(null);
    setAccountBookings([]);
    go("booking");
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
            onClick={() => go(s.id)}
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
        <audio ref={statusAudioRef} src="/status-update-chime.wav" preload="auto" />
        {statusAlert && (
          <div
            className="mx-auto mb-4 flex w-full max-w-[400px] items-start gap-3 rounded-xl p-4 text-sm"
            style={STATUS_ALERT_STYLES[statusAlert.tone]}
          >
            {statusAlert.tone === "success" ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <div className="font-semibold">{statusAlert.title}</div>
              <div className="mt-0.5">{statusAlert.message}</div>
              <div className="mt-2 flex gap-3">
                <button
                  onClick={() => {
                    setStatusAlert(null);
                    go("status");
                  }}
                  className="text-xs font-semibold underline"
                >
                  View details
                </button>
                <button onClick={() => setStatusAlert(null)} className="text-xs font-medium opacity-70">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {driverDataError && (
          <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FCEBEB", color: "#791F1F" }}>
            <AlertCircle size={16} /> {driverDataError}
          </div>
        )}

        {!isDriverOnline && !driverDataError && screen === "booking" && (
          <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#F1EFE8", color: "#2C2C2A" }}>
            <AlertCircle size={16} /> {businessName || "This driver"} isn't taking bookings today — please check back another time.
          </div>
        )}

        {isDriverOnline && !isDriverAvailable && !driverDataError && screen === "booking" && (
          <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FAEEDA", color: "#633806" }}>
            <AlertCircle size={16} /> This driver already has a booking in progress right now — check back
            shortly, or pick a later date/time below.
          </div>
        )}

        {screen === "booking" && (
          <>
            {!resolvingSession && activeGuestBooking && (
              <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center justify-between gap-2 rounded-xl p-4 text-sm" style={{ background: "#E6F1FB", color: "#0C447C" }}>
                <span>You have an active booking with this driver.</span>
                <button onClick={() => go("status")} className="font-semibold underline shrink-0">
                  View status
                </button>
              </div>
            )}
            {todayMatchingRide && (
              <div className="mx-auto mb-4 flex w-full max-w-[400px] items-center justify-between gap-2 rounded-xl p-4 text-sm" style={{ background: "#EAF3DE", color: "#27500A" }}>
                <span>
                  Your <strong>{todayMatchingRide.label}</strong> is today at {todayMatchingRide.time_of_day}.
                </span>
                <button onClick={() => handleUseRecurringRide(todayMatchingRide)} className="font-semibold underline shrink-0">
                  Fill in details
                </button>
              </div>
            )}
            <PassengerBooking
              onSubmit={handleBookingFormSubmit}
              mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN}
              vehicle={vehicle}
              businessName={businessName}
              avgRating={avgRating}
              reviewCount={reviewCount}
              licenceVerified={licenceVerified}
              draft={bookingDraft}
              onDraftChange={setBookingDraft}
              isDriverAvailable={isDriverAvailable}
              driverId={driverId}
              driverPhoneNumber={driverPhoneNumber}
              driverPhotoUrl={driverPhotoUrl}
              vehiclePhotoUrl={vehiclePhotoUrl}
              onOpenAccount={() => {
                authOriginRef.current = "account";
                go(customerSession?.customer ? "account" : "auth");
              }}
              savedLocations={savedLocations}
              onSaveLocation={customerSession?.customer ? handleSaveLocation : undefined}
              onOpenDriverProfile={() => go("driver-profile")}
              onMakeRecurring={customerSession?.customer ? handleAddRecurringRide : undefined}
            />
          </>
        )}

        {screen === "driver-profile" && (
          <DriverProfileScreen
            driverId={driverId}
            businessName={businessName}
            driverPhotoUrl={driverPhotoUrl}
            vehiclePhotoUrl={vehiclePhotoUrl}
            vehicle={vehicle}
            avgRating={avgRating}
            reviewCount={reviewCount}
            licenceVerified={licenceVerified}
            onBack={goBack}
          />
        )}

        {screen === "fare" && (
          <FareEstimateScreen
            mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN}
            pickup={formSelection?.pickup ?? DEMO_PICKUP}
            dropoff={formSelection?.dropoff ?? DEMO_DROPOFF}
            stops={formSelection?.stops ?? []}
            scheduledTime={formSelection?.scheduledTime ?? new Date()}
            fareRules={fareRules}
            preBookingFee={3.0}
            payLaterDepositAmount={payLaterDepositAmount}
            promo={activePromo}
            onConfirm={handleConfirmFare}
            onBack={() => go("booking")}
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
            bookingId={bookingResult.bookingId}
            amount={bookingResult.paymentTiming === "later" ? bookingResult.depositAmount : bookingResult.fare.total}
            paymentTiming={bookingResult.paymentTiming}
            balanceDue={bookingResult.balanceDue}
            onSuccess={() => go("confirmed")}
          />
        )}

        {screen === "payment" && !bookingResult && !creatingBooking && (
          <div className="mx-auto w-full max-w-[400px] p-10 text-center text-sm text-[#8C8977]">
            No booking yet — go through "2. Fare estimate" and tap "Confirm & pay" first.
          </div>
        )}

        {screen === "confirmed" && (
          <BookingConfirmedScreen
            pickup={formSelection?.pickup ?? DEMO_PICKUP}
            dropoff={formSelection?.dropoff ?? DEMO_DROPOFF}
            scheduledTime={formSelection?.scheduledTime ?? new Date()}
            totalPaid={bookingResult?.paymentTiming === "later" ? bookingResult?.depositAmount ?? 0 : bookingResult?.fare?.total ?? 0}
            balanceDue={bookingResult?.paymentTiming === "later" ? bookingResult?.balanceDue : null}
            driverName={businessName}
            driverPhoneNumber={driverPhoneNumber}
            onViewBooking={handleViewBooking}
          />
        )}

        {screen === "guest-choice" && (
          <GuestAccountChoice
            onCreateAccount={() => {
              authOriginRef.current = "post-booking";
              go("auth");
            }}
            onDismiss={() => go("status")}
          />
        )}

        {screen === "auth" && (
          <CustomerAuthScreen
            driverId={driverId}
            driverName={businessName}
            onAuthSuccess={handleAuthSuccess}
            onBack={goBack}
          />
        )}

        {screen === "status" && (
          <BookingStatus
            bookingId={bookingResult?.bookingId ?? activeGuestBooking?.bookingId}
            // Send whichever guest token we actually have, regardless of
            // whether the passenger happens to be signed in right now —
            // a booking made as a guest and then followed by signing in
            // afterward has NO customer_id link to it at all, so the
            // guest token is still the only valid proof of ownership.
            // get-booking-status already tries the guest token first and
            // falls back to the customer session independently, so
            // sending both whenever available is always safe.
            guestAccessToken={bookingResult?.accessToken ?? activeGuestBooking?.accessToken ?? null}
            customerSessionToken={customerSession?.accessToken || null}
            isSharedView={isSharedView}
            onBack={goBack}
            onBookAgain={() => {
              clearGuestBooking();
              setBookingResult(null);
              setFormSelection(null);
              setIsSharedView(false);
              go("booking");
            }}
          />
        )}

        {screen === "account" && (
          <>
            {loadingAccount ? (
              <div className="mx-auto w-full max-w-[400px] p-5">
                <button
                  onClick={goBack}
                  className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
                  aria-label="Back"
                >
                  <ArrowLeft size={15} color="#5F5E5A" />
                </button>
                <div className="flex items-center justify-center gap-2 p-10 text-sm text-[#5F5E5A]">
                  <Loader2 size={16} className="animate-spin" /> Loading your account…
                </div>
              </div>
            ) : accountError ? (
              <div className="mx-auto w-full max-w-[400px] p-5">
                <button
                  onClick={goBack}
                  className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
                  aria-label="Back"
                >
                  <ArrowLeft size={15} color="#5F5E5A" />
                </button>
                <div className="flex items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                  <AlertCircle size={16} /> {accountError}
                </div>
              </div>
            ) : (
              <AccountHistoryScreen
                customer={customerSession?.customer || null}
                bookings={accountBookings}
                savedLocations={savedLocations}
                onDeleteLocation={handleDeleteLocation}
                recurringRides={recurringRides}
                onToggleRecurringRide={handleToggleRecurringRide}
                onDeleteRecurringRide={handleDeleteRecurringRide}
                onSelectBooking={(booking) => {
                  setBookingResult({ bookingId: booking.id, accessToken: null, paymentTiming: null, fare: null });
                  go("status");
                }}
                onBookAgain={(booking) => {
                  // Pre-fills the form with everything except date/time —
                  // a passenger rebooking a past trip almost certainly
                  // wants a NEW time, not the exact original moment, so
                  // that's deliberately left for them to set fresh.
                  setBookingDraft((prev) => ({
                    ...prev,
                    passengerName: booking.passenger_name || prev.passengerName,
                    passengerPhone: booking.passenger_phone || prev.passengerPhone,
                    passengerEmail: booking.passenger_email || prev.passengerEmail,
                    pickup: booking.pickup_address || "",
                    dropoff: booking.dropoff_address || "",
                    pickupCoords:
                      booking.pickup_lat != null
                        ? { lat: booking.pickup_lat, lng: booking.pickup_lng, fullAddress: booking.pickup_address }
                        : null,
                    dropoffCoords:
                      booking.dropoff_lat != null
                        ? { lat: booking.dropoff_lat, lng: booking.dropoff_lng, fullAddress: booking.dropoff_address }
                        : null,
                    date: "",
                    time: "",
                  }));
                  go("booking");
                }}
                onSignOut={handleSignOut}
                onBack={goBack}
                onUpdateProfile={async (name, phone) => {
                  const result = await ensureCustomerRecord({
                    userId: customerSession.userId,
                    email: customerSession.customer.email,
                    name: name || null,
                    phone: phone || null,
                    driverId,
                  });
                  if (result.error) return { error: result.error };
                  setCustomerSession((prev) =>
                    prev ? { ...prev, customer: { ...prev.customer, name, phone } } : prev
                  );
                  return {};
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Persistent way back to the start — this app has no browser-style
          back button of its own, and specific screens (like a cancelled
          booking) could otherwise be a dead end with no way out. Only
          shown when not already on the booking screen. */}
      {screen !== "booking" && (
        <button
          onClick={() => go("booking")}
          className="fixed bottom-2 left-2 z-50 flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-medium opacity-80 hover:opacity-100 transition-opacity"
          style={{ background: "#2C2C2A", color: "#F0EEE7" }}
          aria-label="Back to home"
        >
          <HomeIcon size={13} /> Home
        </button>
      )}

      {/* TEMPORARY diagnostic badge — remove once the notification bug
          is confirmed fixed. Shows exactly what the last poll attempt
          did (success/failure, auth mode used, status comparison) so
          it can be screenshotted instead of guessed at. */}
      {pollDebug && (
        <div
          className="fixed top-2 left-2 right-2 z-50 rounded-lg p-2 text-[10px] font-mono leading-tight"
          style={{ background: "#2C2C2A", color: "#F0EEE7" }}
        >
          {pollDebug.time} booking:{pollDebug.bookingId?.slice(0, 8)} auth:{pollDebug.authMode}
          {pollDebug.error ? (
            <> ERROR:{pollDebug.error}</>
          ) : (
            <>
              {" "}
              status:{pollDebug.status} prev:{String(pollDebug.previousStatus)} init:{String(pollDebug.initialized)} onStatusScreen:{String(pollDebug.onStatusScreen)}
            </>
          )}
        </div>
      )}

      {/* Version badge — small, fixed, out of the way. Exists purely so
          you can glance at the app and confirm which deployed commit
          you're actually testing, rather than guessing from the UI or
          re-checking Vercel's dashboard every time. Tap it to copy the
          full commit SHA (useful when reporting a bug tied to an exact
          build). See vite.config.ts for how these values are injected. */}
      <VersionBadge />
    </div>
  );
}

function VersionBadge() {
  const [copied, setCopied] = useState(false);
  const sha = typeof __APP_COMMIT_SHA__ !== "undefined" ? __APP_COMMIT_SHA__ : "local";
  const buildTime = typeof __APP_BUILD_TIME__ !== "undefined" ? __APP_BUILD_TIME__ : "";
  const buildLabel = buildTime
    ? new Date(buildTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  function handleClick() {
    navigator.clipboard?.writeText(sha).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-2 right-2 z-50 rounded-full px-2.5 py-1 text-[10px] font-mono opacity-60 hover:opacity-100 transition-opacity"
      style={{ background: "#2C2C2A", color: "#F0EEE7" }}
      title="Tap to copy full commit SHA"
    >
      {copied ? "copied!" : `${sha}${buildLabel ? ` · ${buildLabel}` : ""}`}
    </button>
  );
}
