import { useEffect, useState } from "react";
import { MapPin, Calendar, Clock, ArrowRight, User, Navigation, LocateFixed, Loader2, Car, Users, Star } from "lucide-react";
import { searchAddress } from "./mapboxClient";

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

export default function PassengerBooking({ avgRating = null, reviewCount = 0, onSubmit, mapboxToken }) {
  useGoogleFont();
  const [pressed, setPressed] = useState(false);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [formError, setFormError] = useState("");
  const [resolving, setResolving] = useState(false);

  // Coordinates resolved via Mapbox geocoding once the passenger picks a
  // suggestion (or on submit as a fallback). FareEstimateScreen needs
  // {lat, lng, address}, not the raw typed string.
  const [pickupCoords, setPickupCoords] = useState(null);
  const [dropoffCoords, setDropoffCoords] = useState(null);
  const [pickupSuggestions, setPickupSuggestions] = useState([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState([]);

  useEffect(() => {
    if (!mapboxToken || pickup.trim().length < 3 || (pickupCoords && pickupCoords.fullAddress === pickup)) {
      setPickupSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setPickupSuggestions(await searchAddress(pickup, mapboxToken));
      } catch {
        setPickupSuggestions([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [pickup, mapboxToken]);

  useEffect(() => {
    if (!mapboxToken || dropoff.trim().length < 3 || (dropoffCoords && dropoffCoords.fullAddress === dropoff)) {
      setDropoffSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setDropoffSuggestions(await searchAddress(dropoff, mapboxToken));
      } catch {
        setDropoffSuggestions([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [dropoff, mapboxToken]);

  function pickPickupSuggestion(s) {
    setPickup(s.fullAddress);
    setPickupCoords(s);
    setPickupSuggestions([]);
  }

  function pickDropoffSuggestion(s) {
    setDropoff(s.fullAddress);
    setDropoffCoords(s);
    setDropoffSuggestions([]);
  }

  async function handleSubmit() {
    if (!pickup.trim() || !dropoff.trim()) {
      setFormError("Enter both a pickup and drop-off location");
      return;
    }
    if (!date || !time) {
      setFormError("Choose a date and time");
      return;
    }

    let resolvedPickup = pickupCoords;
    let resolvedDropoff = dropoffCoords;

    // Passenger typed an address but never tapped a suggestion — resolve
    // it now so FareEstimateScreen still gets real coordinates.
    if (mapboxToken && (!resolvedPickup || !resolvedDropoff)) {
      setResolving(true);
      try {
        if (!resolvedPickup) {
          const results = await searchAddress(pickup, mapboxToken);
          resolvedPickup = results[0] || null;
        }
        if (!resolvedDropoff) {
          const results = await searchAddress(dropoff, mapboxToken);
          resolvedDropoff = results[0] || null;
        }
      } catch {
        setFormError("Couldn't look up those addresses — check your connection and try again");
        setResolving(false);
        return;
      }
      setResolving(false);
    }

    if (!resolvedPickup || !resolvedDropoff) {
      setFormError(
        mapboxToken
          ? "Couldn't find one of those addresses — try picking a suggestion from the list"
          : "Address lookup isn't configured yet (missing Mapbox token)"
      );
      return;
    }

    setFormError("");
    onSubmit?.({
      pickup: { lat: resolvedPickup.lat, lng: resolvedPickup.lng, address: resolvedPickup.fullAddress || pickup },
      dropoff: { lat: resolvedDropoff.lat, lng: resolvedDropoff.lng, address: resolvedDropoff.fullAddress || dropoff },
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
      (pos) => {
        // In the real app this coordinate pair gets reverse-geocoded via
        // Mapbox into a readable address. Showing coordinates here as a
        // placeholder since this mockup has no live Mapbox key.
        const { latitude, longitude } = pos.coords;
        setPickup(`Current location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`);
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
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{
              background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)",
              boxShadow: "3px 3px 8px rgba(44,44,42,0.14), -2px -2px 6px rgba(255,255,255,0.9)",
            }}
          >
            <Navigation size={17} color="#185FA5" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
              John's Taxi
            </div>
            <div className="text-[11px] text-[#5F5E5A]">Dublin, IE</div>
          </div>
        </div>
        <button
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background: "#F0EEE7",
            boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)",
          }}
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
          Pre-book with John — no app to download, just a quick form.
        </div>
      </div>

      {/* Vehicle + rating strip */}
      <div
        className="mb-5 flex items-center gap-3 rounded-xl px-4 py-3.5"
        style={{
          background: "#FBFAF6",
          border: "1px solid #ECE9E0",
          boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)",
        }}
      >
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)",
            boxShadow: "3px 3px 8px rgba(44,44,42,0.14), -2px -2px 6px rgba(255,255,255,0.9)",
          }}
        >
          <Car size={19} color="#185FA5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-[#2C2C2A]">Toyota Prius · Blue</div>
          <div className="flex items-center gap-1 text-xs text-[#5F5E5A]">
            <Users size={12} /> 4 passenger seats
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
      </div>

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
                <button
                  type="button"
                  onClick={useCurrentLocation}
                  className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: "#E4E2DA", color: "#185FA5" }}
                >
                  {locating ? <Loader2 size={12} className="animate-spin" /> : <LocateFixed size={12} />}
                  {locating ? "Locating…" : "Use current"}
                </button>
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
          <div className="grid grid-cols-2 gap-3">
            <EmbossField icon={Calendar} label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <EmbossField icon={Clock} label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        {formError && <div className="mt-3 text-[11px] text-[#A32D2D]">{formError}</div>}

        <button
          type="button"
          disabled={resolving}
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

