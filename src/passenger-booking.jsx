import { useEffect, useState } from "react";
import { MapPin, Calendar, Clock, ArrowRight, User, Navigation, LocateFixed, Loader2, Car, Users, Star, Phone, Mail, ShieldCheck, AlertCircle, MessageCircle, BookmarkPlus, X, Plus } from "lucide-react";
import { searchAddress, retrieveSuggestion, reverseGeocode, createSearchSessionToken } from "./mapboxClient";
import { supabase } from "./supabaseClient.js";
import { formatPhoneForLinks } from "./phoneLinks.js";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function MapPreview({ hasRoute }) {
  return (
    <div
      className="mb-5 overflow-hidden rounded-xl"
      style={{
        background: "#FBFAF6",
        border: "1px solid #ECE9E0",
        boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)",
      }}
    >
      <svg viewBox="0 0 400 180" className="block w-full" style={{ height: 150 }}>
        <rect width="400" height="180" fill="#EAE8E1" />
        {/* stylized road grid — not a real map, a schematic stand-in */}
        {[40, 110, 180, 250, 320].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="180" stroke="#D8D5CB" strokeWidth="2" />
        ))}
        {[30, 80, 130, 180].map((y) => (
          <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="#D8D5CB" strokeWidth="2" />
        ))}

        {hasRoute ? (
          <>
            <path
              d="M 70 140 Q 180 60 330 45"
              fill="none"
              stroke="#185FA5"
              strokeWidth="3"
              strokeDasharray="7 6"
              strokeLinecap="round"
            />
            <circle cx="70" cy="140" r="7" fill="#2C2C2A" />
            <circle cx="70" cy="140" r="3" fill="#FBFAF6" />
            <circle cx="330" cy="45" r="7" fill="#185FA5" />
            <circle cx="330" cy="45" r="3" fill="#FBFAF6" />
          </>
        ) : (
          <text x="200" y="94" textAnchor="middle" fontSize="12" fill="#8C8977" fontFamily="Inter">
            Enter pickup and drop-off to preview your route
          </text>
        )}
      </svg>
    </div>
  );
}

const DAY_OPTIONS = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" },
];

/** Lets a passenger save the CURRENT trip (once pickup/dropoff have
 * real coordinates) as a recurring template — pre-filling the form on
 * matching future days, not automatically booking or charging. */
function RecurringToggle({ pickupCoords, dropoffCoords, time, onMakeRecurring }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function toggleDay(key) {
    setDays((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]));
  }

  async function handleSave() {
    if (!label.trim() || days.length === 0 || !time) {
      setError("Add a name, pick at least one day, and set a time above");
      return;
    }
    setSaving(true);
    setError("");
    const result = await onMakeRecurring({
      label: label.trim(),
      pickup: { lat: pickupCoords.lat, lng: pickupCoords.lng, address: pickupCoords.fullAddress },
      dropoff: { lat: dropoffCoords.lat, lng: dropoffCoords.lng, address: dropoffCoords.fullAddress },
      daysOfWeek: days,
      timeOfDay: time,
    });
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSaved(true);
    setOpen(false);
  }

  if (saved) {
    return <div className="mt-3 text-xs" style={{ color: "#27500A" }}>Saved as a recurring ride — see Account to manage it.</div>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-semibold" style={{ color: "#185FA5" }}>
        + Make this a recurring ride
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl p-3.5" style={{ background: "#F1EFE8" }}>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name this trip (e.g. Morning commute)"
        className="mb-2.5 w-full rounded-lg bg-white px-3 py-2 text-xs text-[#2C2C2A] placeholder:text-[#B4B2A9]"
      />
      <div className="mb-2.5 flex gap-1.5">
        {DAY_OPTIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => toggleDay(d.key)}
            className="h-7 w-7 rounded-full text-[11px] font-semibold"
            style={{ background: days.includes(d.key) ? "#185FA5" : "#E4E2DA", color: days.includes(d.key) ? "white" : "#5F5E5A" }}
          >
            {d.label}
          </button>
        ))}
      </div>
      {error && <div className="mb-2 text-[11px]" style={{ color: "#A32D2D" }}>{error}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-60"
          style={{ background: "#185FA5" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3.5 py-2 text-xs font-medium text-[#5F5E5A]">
          Cancel
        </button>
      </div>
    </div>
  );
}

// A booking needs some real lead time — "right now, this exact minute"
// isn't realistic for a driver to actually receive and act on. Also
// used to stop a passenger from picking a date/time that's already
// passed entirely (native <input type="date"/"time"> `min` attributes
// help visually, but aren't reliably enforced by every mobile date
// picker, so this is re-checked explicitly in handleSubmit too, and
// again server-side in create-booking — never trust the client alone).
const MIN_BOOKING_LEAD_MINUTES = 10;

function minBookableDate() {
  return new Date(Date.now() + MIN_BOOKING_LEAD_MINUTES * 60000);
}

function EmbossField({ icon: Icon, label, trailing, ...props }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-[#5F5E5A]">{label}</label>
      <div
        className="flex items-center gap-2.5 rounded-xl px-4 py-3"
        style={{
          background: "#F0EEE7",
          boxShadow: "inset 2px 2px 5px rgba(44,44,42,0.14), inset -2px -2px 5px rgba(255,255,255,0.8)",
        }}
      >
        <Icon size={16} color="#8C8977" />
        <input
          {...props}
          className="w-full bg-transparent text-sm outline-none placeholder:text-[#8C8977]"
          style={{ color: "#2C2C2A" }}
        />
        {trailing}
      </div>
    </div>
  );
}

/** One intermediate stop's address field — manages its own transient
 * search-suggestion state exactly like pickup/dropoff do, just scoped
 * to this one stop instead of lifted into the shared draft (suggestion
 * lists don't need to survive a screen change, same reasoning as the
 * pickup/dropoff suggestion state above). */
function StopField({ stop, index, mapboxToken, onChange, onRemove }) {
  const [suggestions, setSuggestions] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [session, setSession] = useState(() => createSearchSessionToken());

  useEffect(() => {
    if (!mapboxToken || stop.address.trim().length < 3 || (stop.coords && stop.coords.fullAddress === stop.address)) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const result = await searchAddress(stop.address, mapboxToken, session);
        setSuggestions(result.suggestions);
        setSearchError("");
      } catch (err) {
        // Was previously silently swallowed — looked exactly like "no
        // results found" for any real cause (bad token, wrong token
        // scope, network issue), with zero way to tell them apart.
        console.error("Mapbox address search failed:", err);
        setSuggestions([]);
        setSearchError("Address search isn't working right now.");
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.address, mapboxToken, session]);

  async function pickSuggestion(s) {
    setSuggestions([]);
    try {
      const coords = await retrieveSuggestion(s.mapboxId, mapboxToken, session);
      onChange({ address: s.fullAddress, coords: coords ? { ...coords, fullAddress: s.fullAddress } : null });
    } catch {
      onChange({ address: s.fullAddress, coords: null });
    }
    setSession(createSearchSessionToken());
  }

  return (
    <div className="relative">
      <EmbossField
        icon={MapPin}
        label={`Stop ${index + 1}`}
        placeholder="e.g. Dublin Airport"
        value={stop.address}
        onChange={(e) => onChange({ address: e.target.value, coords: null })}
        trailing={
          <button type="button" onClick={onRemove} className="shrink-0 rounded-full p-1" style={{ color: "#B4B2A9" }} aria-label="Remove stop">
            <X size={13} />
          </button>
        }
      />
      {suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl"
          style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "0 8px 20px rgba(44,44,42,0.15)" }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pickSuggestion(s)}
              className="block w-full px-4 py-2.5 text-left text-xs text-[#2C2C2A] hover:bg-[#F0EEE7]"
            >
              {s.fullAddress}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PassengerBooking({
  avgRating = null,
  reviewCount = 0,
  onSubmit,
  mapboxToken,
  vehicle,
  businessName,
  licenceVerified = false,
  draft,
  onDraftChange,
  isDriverAvailable = true,
  driverId,
  driverPhoneNumber,
  driverPhotoUrl,
  vehiclePhotoUrl,
  onOpenAccount,
  savedLocations = [],
  onSaveLocation,
  onOpenDriverProfile,
  onMakeRecurring,
}) {
  useGoogleFont();
  const [pressed, setPressed] = useState(false);
  const phoneLinks = formatPhoneForLinks(driverPhoneNumber);

  // Persisted fields live in the parent's `draft` object (App.jsx) so
  // they survive navigating away from this screen and back — this
  // component gets unmounted whenever `screen` changes, which would
  // otherwise wipe everything typed. Read/write through small helpers
  // so the rest of this file can still just call setPickup(...) etc.
  const patchDraft = (patch) => onDraftChange?.((prev) => ({ ...prev, ...patch }));
  const { passengerName, passengerPhone, passengerEmail, pickup, dropoff, pickupCoords, dropoffCoords, date, time, stops = [] } = draft;
  const setPassengerName = (v) => patchDraft({ passengerName: v });
  const setPassengerPhone = (v) => patchDraft({ passengerPhone: v });
  const setPassengerEmail = (v) => patchDraft({ passengerEmail: v });
  const setPickup = (v) => patchDraft({ pickup: v });
  const setDropoff = (v) => patchDraft({ dropoff: v });
  const setPickupCoords = (v) => patchDraft({ pickupCoords: v });
  const setDropoffCoords = (v) => patchDraft({ dropoffCoords: v });
  const setDate = (v) => patchDraft({ date: v });
  const setTime = (v) => patchDraft({ time: v });

  // Intermediate stops, in order, between pickup and dropoff. Each is
  // {id, address, coords} — coords null until a real suggestion is
  // picked, same as pickup/dropoff. Capped at 3 — enough for real
  // multi-stop trips (school run + shop, etc.) without letting the
  // route (and therefore the fare) balloon unreasonably.
  const MAX_STOPS = 3;
  function addStop() {
    if (stops.length >= MAX_STOPS) return;
    patchDraft({ stops: [...stops, { id: `stop-${Date.now()}`, address: "", coords: null }] });
  }
  function updateStop(id, patch) {
    patchDraft({ stops: stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function removeStop(id) {
    patchDraft({ stops: stops.filter((s) => s.id !== id) });
  }

  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [formError, setFormError] = useState("");
  const [resolving, setResolving] = useState(false);

  // Real-time, per-selected-time availability check — distinct from
  // isDriverAvailable (which only reflects "right now"). A driver can
  // have a future booking that only blocks THAT specific overlapping
  // window; this checks the exact date/time the passenger has picked
  // against is_driver_available_at() so they find out immediately
  // rather than after filling in the whole form.
  const [slotAvailable, setSlotAvailable] = useState(true);
  const [checkingSlot, setCheckingSlot] = useState(false);

  useEffect(() => {
    if (!driverId || !date || !time) {
      setSlotAvailable(true);
      return;
    }
    let cancelled = false;
    const requestedTime = new Date(`${date}T${time}`);
    if (isNaN(requestedTime.getTime())) {
      setSlotAvailable(true);
      return;
    }

    setCheckingSlot(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("is_driver_available_at", {
        p_driver_id: driverId,
        p_requested_time: requestedTime.toISOString(),
      });
      if (cancelled) return;
      setCheckingSlot(false);
      // On error, don't block the passenger — create-booking re-checks
      // this server-side regardless, so a failed client-side check here
      // just means they find out one step later instead of right away.
      setSlotAvailable(error ? true : data !== false);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [driverId, date, time]);

  // Transient — suggestion lists and search sessions don't need to
  // survive a screen change, so these stay as ordinary local state.
  const [pickupSuggestions, setPickupSuggestions] = useState([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState([]);
  const [addressSearchError, setAddressSearchError] = useState("");
  // Search Box API session tokens — one per field, persisted across
  // keystrokes within a session and regenerated after a selection is
  // made, per Mapbox's documented session-billing pattern.
  const [pickupSession, setPickupSession] = useState(() => createSearchSessionToken());
  const [dropoffSession, setDropoffSession] = useState(() => createSearchSessionToken());

  useEffect(() => {
    if (!mapboxToken) {
      // A missing VITE_MAPBOX_TOKEN env var previously failed exactly
      // the same silent way as every other error here — worth its own
      // clear message rather than looking identical to "no results".
      setAddressSearchError("Address search isn't configured — missing Mapbox token.");
    }
    if (!mapboxToken || pickup.trim().length < 3 || (pickupCoords && pickupCoords.fullAddress === pickup)) {
      setPickupSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const result = await searchAddress(pickup, mapboxToken, pickupSession);
        setPickupSuggestions(result.suggestions);
        setAddressSearchError("");
      } catch (err) {
        // Was silently swallowed before — looked exactly like "no
        // results" for a bad/missing token, wrong token scope, or a
        // real network error, with zero way to tell them apart.
        console.error("Mapbox pickup search failed:", err);
        setPickupSuggestions([]);
        setAddressSearchError("Address search isn't working right now — try again in a moment.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [pickup, mapboxToken, pickupSession]);

  useEffect(() => {
    if (!mapboxToken || dropoff.trim().length < 3 || (dropoffCoords && dropoffCoords.fullAddress === dropoff)) {
      setDropoffSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const result = await searchAddress(dropoff, mapboxToken, dropoffSession);
        setDropoffSuggestions(result.suggestions);
        setAddressSearchError("");
      } catch (err) {
        console.error("Mapbox dropoff search failed:", err);
        setDropoffSuggestions([]);
        setAddressSearchError("Address search isn't working right now — try again in a moment.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [dropoff, mapboxToken, dropoffSession]);

  async function pickPickupSuggestion(s) {
    setPickup(s.fullAddress);
    setPickupSuggestions([]);
    setFormError("");
    try {
      const coords = await retrieveSuggestion(s.mapboxId, mapboxToken, pickupSession);
      setPickupCoords(coords ? { ...coords, fullAddress: s.fullAddress } : null);
    } catch {
      setPickupCoords(null);
      setFormError("Couldn't get details for that pickup location — try again");
    }
    // Session ends after a selection; start a fresh one for the next search.
    setPickupSession(createSearchSessionToken());
  }

  async function pickDropoffSuggestion(s) {
    setDropoff(s.fullAddress);
    setDropoffSuggestions([]);
    setFormError("");
    try {
      const coords = await retrieveSuggestion(s.mapboxId, mapboxToken, dropoffSession);
      setDropoffCoords(coords ? { ...coords, fullAddress: s.fullAddress } : null);
    } catch {
      setDropoffCoords(null);
      setFormError("Couldn't get details for that drop-off location — try again");
    }
    setDropoffSession(createSearchSessionToken());
  }

  async function handleSubmit() {
    if (!isDriverAvailable) {
      setFormError("This driver isn't available right now — check back shortly.");
      return;
    }
    if (!passengerName.trim() || !passengerPhone.trim()) {
      setFormError("Enter your name and phone number");
      return;
    }
    if (!pickup.trim() || !dropoff.trim()) {
      setFormError("Enter both a pickup and drop-off location");
      return;
    }
    if (!date || !time) {
      setFormError("Choose a date and time");
      return;
    }
    const requestedDateTime = new Date(`${date}T${time}`);
    if (isNaN(requestedDateTime.getTime()) || requestedDateTime < minBookableDate()) {
      setFormError("Please choose a time at least a few minutes from now — that time has already passed.");
      return;
    }
    if (!slotAvailable) {
      setFormError("This driver already has a booking around that time — please choose a different time");
      return;
    }

    // Unlike the old Geocoding API, Search Box results only carry
    // coordinates after /retrieve — so if the passenger typed an address
    // and never tapped a suggestion, we don't have coordinates for it.
    // Require picking from the list rather than silently guessing.
    if (!pickupCoords || pickupCoords.fullAddress !== pickup) {
      setFormError("Please select your pickup location from the suggestions list");
      return;
    }
    if (!dropoffCoords || dropoffCoords.fullAddress !== dropoff) {
      setFormError("Please select your drop-off location from the suggestions list");
      return;
    }
    // Same "must pick from suggestions" rule as pickup/dropoff — a stop
    // with a typed-but-never-selected address has no coordinates to
    // build a route with.
    for (const stop of stops) {
      if (!stop.address.trim()) continue; // an empty stop field is just ignored, not an error
      if (!stop.coords || stop.coords.fullAddress !== stop.address) {
        setFormError(`Please select stop ${stops.indexOf(stop) + 1} from the suggestions list, or remove it`);
        return;
      }
    }

    setFormError("");
    onSubmit?.({
      passengerName: passengerName.trim(),
      passengerPhone: passengerPhone.trim(),
      // Optional — only used so Stripe can email a receipt. A guest who
      // skips it still completes the booking fine, they just won't get
      // an emailed receipt (Stripe's PaymentIntent.receipt_email is
      // simply omitted server-side in that case).
      passengerEmail: passengerEmail.trim() || null,
      pickup: { lat: pickupCoords.lat, lng: pickupCoords.lng, address: pickupCoords.fullAddress },
      dropoff: { lat: dropoffCoords.lat, lng: dropoffCoords.lng, address: dropoffCoords.fullAddress },
      stops: stops
        .filter((s) => s.address.trim() && s.coords)
        .map((s) => ({ lat: s.coords.lat, lng: s.coords.lng, address: s.coords.fullAddress })),
      date,
      time,
    });
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError("Location isn't available on this device");
      return;
    }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const result = await reverseGeocode(longitude, latitude, mapboxToken);
          if (result) {
            setPickup(result.fullAddress);
            setPickupCoords({ ...result, fullAddress: result.fullAddress });
          } else {
            setLocationError("Couldn't find an address for your location — enter it manually");
          }
        } catch {
          setLocationError("Couldn't look up your address — enter it manually");
        }
        setLocating(false);
      },
      () => {
        setLocationError("Couldn't get your location — enter it manually");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-[400px] p-5"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}
    >
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full"
            style={{
              background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)",
              boxShadow: "3px 3px 8px rgba(44,44,42,0.14), -2px -2px 6px rgba(255,255,255,0.9)",
            }}
          >
            {driverPhotoUrl ? (
              <img src={driverPhotoUrl} alt={businessName || "Driver"} className="h-full w-full object-cover" />
            ) : (
              <Navigation size={17} color="#185FA5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
                {businessName || "Loading…"}
              </span>
              {licenceVerified && (
                <span
                  className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
                  style={{ background: "#EAF3DE" }}
                  title="This driver's SPSV licence has been verified against the National Transport Authority's public register"
                >
                  <ShieldCheck size={10} color="#27500A" />
                  <span className="text-[9px] font-semibold" style={{ color: "#27500A" }}>Verified</span>
                </span>
              )}
            </div>
            <div className="text-[11px] text-[#5F5E5A]">Dublin, IE</div>
          </div>
        </div>
        <button
          onClick={onOpenAccount}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background: "#F0EEE7",
            boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)",
          }}
          aria-label="Sign in / account"
        >
          <User size={15} color="#5F5E5A" />
        </button>
      </div>

      {/* Hero */}
      <div className="mb-5">
        <div
          className="text-2xl leading-tight text-[#2C2C2A]"
          style={{ fontFamily: "'Space Grotesk'", fontWeight: 700 }}
        >
          Book your ride,
          <br />
          ahead of time.
        </div>
        <div className="mt-1.5 text-sm text-[#5F5E5A]">
          Pre-book with {businessName ? businessName.split(" ")[0] : "your driver"} — no app to download, just a quick form.
        </div>
      </div>

      {/* Vehicle + rating strip — tappable, opens the full driver
          profile with real reviews (previously just a static display
          with no way to actually read what those reviews said). */}
      <button
        type="button"
        onClick={onOpenDriverProfile}
        className="mb-5 flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left"
        style={{
          background: "#FBFAF6",
          border: "1px solid #ECE9E0",
          boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)",
        }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full"
          style={{
            background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)",
            boxShadow: "3px 3px 8px rgba(44,44,42,0.14), -2px -2px 6px rgba(255,255,255,0.9)",
          }}
        >
          {vehiclePhotoUrl ? (
            <img src={vehiclePhotoUrl} alt="Vehicle" className="h-full w-full object-cover" />
          ) : (
            <Car size={19} color="#185FA5" />
          )}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-[#2C2C2A]">
            {vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.color}` : "Vehicle details unavailable"}
          </div>
          <div className="flex items-center gap-1 text-xs text-[#5F5E5A]">
            <Users size={12} /> {vehicle?.seats ?? "—"} passenger seats
          </div>
        </div>
        <div
          className="flex items-center gap-1 rounded-full px-2.5 py-1"
          style={{ background: avgRating ? "#EAF3DE" : "#F1EFE8" }}
        >
          {avgRating ? (
            <>
              <Star size={12} fill="#639922" color="#639922" />
              <span className="text-xs font-medium" style={{ color: "#27500A" }}>
                {avgRating} <span style={{ color: "#5F5E5A", fontWeight: 400 }}>({reviewCount})</span>
              </span>
            </>
          ) : (
            <span className="text-xs font-medium text-[#5F5E5A]">New driver</span>
          )}
        </div>
      </button>

      {/* Contact the driver directly — visible before booking, not just
          after. Uses the same phoneLinks helper as the post-booking
          confirmation/tracking screens for consistent tel:/wa.me links. */}
      {phoneLinks && (
        <div className="mb-5 flex gap-2">
          <a
            href={`tel:${phoneLinks.tel}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-[#2C2C2A]"
            style={{ background: "#F0EEE7", boxShadow: "2px 2px 5px rgba(44,44,42,0.1), -2px -2px 5px rgba(255,255,255,0.7)" }}
          >
            <Phone size={13} /> Call {businessName ? businessName.split(" ")[0] : "driver"}
          </a>
          <a
            href={`https://wa.me/${phoneLinks.whatsapp}`}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-white"
            style={{ background: "#25D366" }}
          >
            <MessageCircle size={13} /> WhatsApp
          </a>
        </div>
      )}

      <MapPreview hasRoute={pickup.trim().length > 0 && dropoff.trim().length > 0} />

      {/* Booking form card */}
      <div
        className="rounded-2xl p-5"
        style={{
          background: "#FBFAF6",
          border: "1px solid #ECE9E0",
          boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)",
        }}
      >
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <EmbossField
              icon={User}
              label="Your name"
              placeholder="Jane Doe"
              value={passengerName}
              onChange={(e) => setPassengerName(e.target.value)}
            />
            <EmbossField
              icon={Phone}
              label="Phone"
              type="tel"
              placeholder="+353 87 000 0000"
              value={passengerPhone}
              onChange={(e) => setPassengerPhone(e.target.value)}
            />
          </div>
          <EmbossField
            icon={Mail}
            label="Email (optional — for your receipt)"
            type="email"
            placeholder="you@example.com"
            value={passengerEmail}
            onChange={(e) => setPassengerEmail(e.target.value)}
          />
          {savedLocations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {savedLocations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    // Fills whichever field is currently empty first —
                    // usually pickup, since that's typically where a
                    // trip from a saved place (Home/Work) starts.
                    const target = !pickup ? "pickup" : !dropoff ? "dropoff" : "pickup";
                    const coordsPayload = { lat: loc.lat, lng: loc.lng, fullAddress: loc.address };
                    if (target === "pickup") {
                      setPickup(loc.address);
                      setPickupCoords(loc.lat != null ? coordsPayload : null);
                    } else {
                      setDropoff(loc.address);
                      setDropoffCoords(loc.lat != null ? coordsPayload : null);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
                  style={{ background: "#E4E2DA", color: "#2C2C2A" }}
                >
                  <MapPin size={11} /> {loc.label}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <EmbossField
              icon={MapPin}
              label="Pickup location"
              placeholder="e.g. Grafton St"
              value={pickup}
              onChange={(e) => {
                setPickup(e.target.value);
                setPickupCoords(null);
              }}
              trailing={
                <div className="flex shrink-0 items-center gap-1.5">
                  {onSaveLocation && pickupCoords && pickupCoords.fullAddress === pickup && (
                    <button
                      type="button"
                      onClick={() => {
                        const label = window.prompt("Save this pickup as (e.g. Home, Work):");
                        if (label) onSaveLocation({ label, address: pickup, lat: pickupCoords.lat, lng: pickupCoords.lng });
                      }}
                      title="Save this address"
                      className="flex items-center justify-center rounded-full p-1.5"
                      style={{ background: "#E4E2DA", color: "#185FA5" }}
                    >
                      <BookmarkPlus size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{ background: "#E4E2DA", color: "#185FA5" }}
                  >
                    {locating ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
                    {locating ? "Locating…" : "Use current"}
                  </button>
                </div>
              }
            />
            {pickupSuggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl"
                style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "0 8px 20px rgba(44,44,42,0.15)" }}
              >
                {pickupSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickPickupSuggestion(s)}
                    className="block w-full px-4 py-2.5 text-left text-xs text-[#2C2C2A] hover:bg-[#F0EEE7]"
                  >
                    {s.fullAddress}
                  </button>
                ))}
              </div>
            )}
          </div>
          {locationError && <div className="text-[11px] text-[#A32D2D]">{locationError}</div>}

          {stops.map((stop, i) => (
            <StopField
              key={stop.id}
              stop={stop}
              index={i}
              mapboxToken={mapboxToken}
              onChange={(patch) => updateStop(stop.id, patch)}
              onRemove={() => removeStop(stop.id)}
            />
          ))}
          {stops.length < MAX_STOPS && (
            <button
              type="button"
              onClick={addStop}
              className="flex items-center gap-1.5 self-start text-xs font-semibold"
              style={{ color: "#185FA5" }}
            >
              <Plus size={13} /> Add a stop
            </button>
          )}

          <div className="relative">
            <EmbossField
              icon={MapPin}
              label="Drop-off location"
              placeholder="e.g. Dublin Airport"
              value={dropoff}
              onChange={(e) => {
                setDropoff(e.target.value);
                setDropoffCoords(null);
              }}
              trailing={
                onSaveLocation && dropoffCoords && dropoffCoords.fullAddress === dropoff ? (
                  <button
                    type="button"
                    onClick={() => {
                      const label = window.prompt("Save this drop-off as (e.g. Home, Work):");
                      if (label) onSaveLocation({ label, address: dropoff, lat: dropoffCoords.lat, lng: dropoffCoords.lng });
                    }}
                    title="Save this address"
                    className="flex shrink-0 items-center justify-center rounded-full p-1.5"
                    style={{ background: "#E4E2DA", color: "#185FA5" }}
                  >
                    <BookmarkPlus size={12} />
                  </button>
                ) : null
              }
            />
            {dropoffSuggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl"
                style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "0 8px 20px rgba(44,44,42,0.15)" }}
              >
                {dropoffSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickDropoffSuggestion(s)}
                    className="block w-full px-4 py-2.5 text-left text-xs text-[#2C2C2A] hover:bg-[#F0EEE7]"
                  >
                    {s.fullAddress}
                  </button>
                ))}
              </div>
            )}
          </div>
          {addressSearchError && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg p-2 text-[11px]" style={{ background: "#FCEBEB", color: "#791F1F" }}>
              <AlertCircle size={11} /> {addressSearchError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <EmbossField
              icon={Calendar}
              label="Date"
              type="date"
              value={date}
              min={minBookableDate().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
            <EmbossField
              icon={Clock}
              label="Time"
              type="time"
              value={time}
              // A `min` on the time input only makes sense when the
              // selected date IS today — an earlier time on a future
              // date is perfectly valid. Native browser support for
              // combining date+time min varies, hence the explicit
              // recheck in handleSubmit below regardless.
              min={date === minBookableDate().toISOString().slice(0, 10) ? minBookableDate().toTimeString().slice(0, 5) : undefined}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          {checkingSlot && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8C8977]">
              <Loader2 size={11} className="animate-spin" /> Checking availability for that time…
            </div>
          )}
          {!checkingSlot && !slotAvailable && date && time && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: "#A32D2D" }}>
              <AlertCircle size={11} /> This driver already has a booking around that time — try a different time.
            </div>
          )}
        </div>

        {onMakeRecurring && pickupCoords && dropoffCoords && (
          <RecurringToggle
            pickupCoords={pickupCoords}
            dropoffCoords={dropoffCoords}
            time={time}
            onMakeRecurring={onMakeRecurring}
          />
        )}

        {formError && <div className="mt-3 text-[11px] text-[#A32D2D]">{formError}</div>}

        <button
          type="button"
          disabled={resolving || !isDriverAvailable || (date && time && !slotAvailable)}
          onClick={handleSubmit}
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:opacity-70"
          style={{
            background: "linear-gradient(135deg, #378ADD, #0C447C)",
            boxShadow: pressed
              ? "inset 2px 2px 5px rgba(4,44,83,0.5), inset -2px -2px 4px rgba(133,183,235,0.35)"
              : "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
            transform: pressed ? "translateY(1px)" : "translateY(0)",
            transition: "box-shadow 0.12s ease, transform 0.08s ease",
          }}
        >
          {resolving ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Finding route…
            </>
          ) : !isDriverAvailable ? (
            "Driver unavailable right now"
          ) : date && time && !slotAvailable ? (
            "Driver busy at that time"
          ) : (
            <>
              Get fare estimate <ArrowRight size={15} />
            </>
          )}
        </button>
      </div>

      <div className="mt-4 text-center text-[11px] text-[#8C8977]">
        No account needed to book — sign up after to save your trip history.
      </div>
    </div>
  );
}

