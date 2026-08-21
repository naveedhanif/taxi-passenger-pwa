#!/bin/bash
set -e

echo 'Applying outstanding fixes to the passenger app...'
echo 'This includes: bigger touch targets on 3 screens, plus the new'
echo 'Supabase client and real-time booking status hook.'

echo 'Writing src/passenger-booking.jsx...'
cat > src/passenger-booking.jsx << 'FILE_EOF_0'
import { useEffect, useState } from "react";
import { MapPin, Calendar, Clock, ArrowRight, User, Navigation, LocateFixed, Loader2, Car, Users, Star } from "lucide-react";

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

export default function PassengerBooking({ avgRating = null, reviewCount = 0 }) {
  useGoogleFont();
  const [pressed, setPressed] = useState(false);
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");

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
          <EmbossField
            icon={MapPin}
            label="Pickup location"
            placeholder="e.g. Grafton St"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
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
          {locationError && <div className="text-[11px] text-[#A32D2D]">{locationError}</div>}
          <EmbossField
            icon={MapPin}
            label="Drop-off location"
            placeholder="e.g. Dublin Airport"
            value={dropoff}
            onChange={(e) => setDropoff(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <EmbossField icon={Calendar} label="Date" type="date" />
            <EmbossField icon={Clock} label="Time" type="time" />
          </div>
        </div>

        <button
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
          style={{
            background: "linear-gradient(135deg, #378ADD, #0C447C)",
            boxShadow: pressed
              ? "inset 2px 2px 5px rgba(4,44,83,0.5), inset -2px -2px 4px rgba(133,183,235,0.35)"
              : "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
            transform: pressed ? "translateY(1px)" : "translateY(0)",
            transition: "box-shadow 0.12s ease, transform 0.08s ease",
          }}
        >
          Get fare estimate <ArrowRight size={15} />
        </button>
      </div>

      <div className="mt-4 text-center text-[11px] text-[#8C8977]">
        No account needed to book — sign up after to save your trip history.
      </div>
    </div>
  );
}

FILE_EOF_0

echo 'Writing src/passenger-booking-status.jsx...'
cat > src/passenger-booking-status.jsx << 'FILE_EOF_1'
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Calendar, Clock, ArrowLeft, Car, CheckCircle2, Phone, X } from "lucide-react";

// Requires: npm install mapbox-gl
// Requires: a Mapbox access token in your .env as VITE_MAPBOX_TOKEN
// (get one free at https://account.mapbox.com/access-tokens/)
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

// Mock coordinates standing in for real geocoded pickup/dropoff —
// replace with the actual lat/lng from the booking record.
const PICKUP = [-6.2603, 53.3419]; // Grafton St
const DROPOFF = [-6.2499, 53.4213]; // Dublin Airport
const DRIVER_BASE = [-6.2815, 53.335]; // driver's simulated starting point

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Where the driver marker sits for each stage, expressed as a
// progress fraction along DRIVER_BASE -> PICKUP. Real position should
// come from the `live_tracking` table via a Realtime subscription
// instead of this simulated interpolation.
const DRIVER_PROGRESS = { confirmed: 0, en_route: 0.55, arrived: 1, completed: 1 };

function LiveTrackingMap({ stage }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const [missingToken] = useState(!mapboxgl.accessToken);

  // Init map once
  useEffect(() => {
    if (missingToken || !containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: PICKUP,
      zoom: 12,
      attributionControl: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Straight-line route placeholder — swap for a real Mapbox
      // Directions API call to draw the actual road route.
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [PICKUP, DROPOFF] } },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#185FA5", "line-width": 3, "line-dasharray": [0.3, 1.6] },
      });

      new mapboxgl.Marker({ color: "#639922" }).setLngLat(PICKUP).addTo(map);
      new mapboxgl.Marker({ color: "#A32D2D" }).setLngLat(DROPOFF).addTo(map);

      const el = document.createElement("div");
      el.style.width = "34px";
      el.style.height = "34px";
      el.style.borderRadius = "50%";
      el.style.background = "linear-gradient(155deg, #FFFFFF, #E7E5DD)";
      el.style.boxShadow = "4px 4px 10px rgba(44,44,42,0.16), -3px -3px 8px rgba(255,255,255,0.9)";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#185FA5" stroke-width="2"><path d="M5 17h14M5 17a2 2 0 100 4 2 2 0 000-4zm14 0a2 2 0 100 4 2 2 0 000-4zM5 17l1.5-6h11L19 17M6.5 11l1-3h9l1 3"/></svg>';
      driverMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat(lerp(DRIVER_BASE, PICKUP, DRIVER_PROGRESS[stage]))
        .addTo(map);

      map.fitBounds([PICKUP, DROPOFF, DRIVER_BASE], { padding: 50, duration: 0 });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingToken]);

  // Move the driver marker whenever the trip stage changes
  useEffect(() => {
    if (!driverMarkerRef.current) return;
    driverMarkerRef.current.setLngLat(lerp(DRIVER_BASE, PICKUP, DRIVER_PROGRESS[stage]));
  }, [stage]);

  if (missingToken) {
    return (
      <div className="flex h-44 flex-col items-center justify-center gap-1.5 px-6 text-center">
        <Car size={22} color="#8C8977" />
        <div className="text-xs font-medium text-[#5F5E5A]">Map unavailable</div>
        <div className="text-[11px] text-[#8C8977]">Set VITE_MAPBOX_TOKEN in your .env to show live tracking</div>
      </div>
    );
  }

  return <div ref={containerRef} className="h-44 w-full" />;
}

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

const STAGES = ["confirmed", "en_route", "arrived", "completed"];
const STAGE_LABEL = {
  confirmed: "Confirmed",
  en_route: "En route",
  arrived: "Driver has arrived",
  completed: "Trip completed",
};
const STAGE_SUB = {
  confirmed: "John will be on his way closer to pickup time",
  en_route: "John is heading to your pickup location",
  arrived: "Your driver is waiting outside",
  completed: "Thanks for riding with John's Taxi",
};

function EmbossCard({ children, className = "" }) {
  return (
    <div
      className={className}
      style={{
        background: "#FBFAF6",
        border: "1px solid #ECE9E0",
        boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)",
        borderRadius: 16,
      }}
    >
      {children}
    </div>
  );
}

export default function BookingStatus() {
  useGoogleFont();
  const [stage, setStage] = useState("en_route");
  const stageIndex = STAGES.indexOf(stage);
  const isDone = stage === "completed";

  return (
    <div
      className="mx-auto w-full max-w-[400px] p-5"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 700 }}
    >
      {/* Top bar */}
      <div className="mb-5 flex items-center justify-between">
        <button
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">Your booking</div>
        <div className="w-9" />
      </div>

      {/* Demo-only status switcher — not part of the real UI, lets you preview every stage */}
      <div className="mb-5 flex gap-1.5 rounded-full p-1" style={{ background: "#EFEDE5" }}>
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setStage(s)}
            className="flex-1 rounded-full py-1.5 text-[10px] font-medium capitalize transition-colors"
            style={{
              background: stage === s ? "#185FA5" : "transparent",
              color: stage === s ? "#FFFFFF" : "#8C8977",
            }}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Status banner */}
      <EmbossCard className="mb-4 p-5">
        <div className="flex items-center gap-3">
          {isDone ? (
            <CheckCircle2 size={22} color="#639922" />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full"
              style={{
                background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)",
                boxShadow: "3px 3px 8px rgba(44,44,42,0.14), -2px -2px 6px rgba(255,255,255,0.9)",
              }}
            >
              <Car size={18} color="#185FA5" />
            </div>
          )}
          <div>
            <div className="text-base font-semibold text-[#2C2C2A]">{STAGE_LABEL[stage]}</div>
            <div className="text-xs text-[#5F5E5A]">{STAGE_SUB[stage]}</div>
          </div>
        </div>

        {/* Step progress */}
        <div className="mt-4 flex items-center">
          {STAGES.map((s, i) => (
            <div key={s} className="flex flex-1 items-center last:flex-none">
              <div
                className="h-2 w-2 rounded-full"
                style={{ background: i <= stageIndex ? "#185FA5" : "#D3D1C7" }}
              />
              {i < STAGES.length - 1 && (
                <div
                  className="mx-1 h-0.5 flex-1"
                  style={{ background: i < stageIndex ? "#185FA5" : "#D3D1C7" }}
                />
              )}
            </div>
          ))}
        </div>
      </EmbossCard>

      {/* Live map */}
      {!isDone && (
        <EmbossCard className="mb-4 overflow-hidden">
          <div className="relative">
            <LiveTrackingMap stage={stage} />
            <div className="absolute bottom-3 right-3 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-[#2C2C2A] shadow-sm">
              {stage === "confirmed" ? "ETA 42 min" : stage === "en_route" ? "ETA 6 min" : "Outside now"}
            </div>
          </div>
        </EmbossCard>
      )}

      {/* Driver card */}
      <EmbossCard className="mb-4 flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
          >
            J
          </div>
          <div>
            <div className="text-sm font-medium text-[#2C2C2A]">John — John's Taxi</div>
            <div className="text-xs text-[#5F5E5A]">Toyota Prius · Blue · 141-D-4521</div>
          </div>
        </div>
        <button
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <Phone size={14} color="#185FA5" />
        </button>
      </EmbossCard>

      {/* Trip details */}
      <EmbossCard className="mb-4 p-4">
        <div className="mb-3 text-xs font-medium text-[#5F5E5A]">Trip details</div>
        <div className="space-y-2.5 text-sm">
          <div className="flex items-start gap-2">
            <MapPin size={14} color="#8C8977" className="mt-0.5" />
            <div>
              <div className="text-[#2C2C2A]">Grafton St</div>
              <div className="text-[11px] text-[#8C8977]">Pickup</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={14} color="#185FA5" className="mt-0.5" />
            <div>
              <div className="text-[#2C2C2A]">Dublin Airport</div>
              <div className="text-[11px] text-[#8C8977]">Drop-off</div>
            </div>
          </div>
          <div className="flex items-center gap-4 pt-1.5">
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <Calendar size={12} /> Wed, 19 Aug
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <Clock size={12} /> 14:20
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#ECE9E0] pt-3">
          <span className="text-xs text-[#5F5E5A]">{isDone ? "Total charged" : "Estimated fare"}</span>
          <span className="text-base font-semibold text-[#2C2C2A]">€18.40</span>
        </div>
      </EmbossCard>

      {isDone ? (
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
          style={{
            background: "linear-gradient(135deg, #378ADD, #0C447C)",
            boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
          }}
        >
          Book John again
        </button>
      ) : (
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium"
          style={{
            background: "#F0EEE7",
            color: "#A32D2D",
            boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)",
          }}
        >
          <X size={14} /> Cancel booking
        </button>
      )}
    </div>
  );
}

FILE_EOF_1

echo 'Writing src/FareEstimateScreen.jsx...'
cat > src/FareEstimateScreen.jsx << 'FILE_EOF_2'
import { useEffect, useState } from "react";
import { MapPin, Clock, Route as RouteIcon, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { getRoute } from "./mapboxClient";
import { getTariffPeriod, calculateFare, selectFareRule } from "./fareCalculator";
import LiveMapView from "./LiveMapView";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

const TARIFF_LABEL = {
  standard: { label: "Standard rate", bg: "#EAF3DE", text: "#27500A" },
  premium: { label: "Premium rate", bg: "#FAEEDA", text: "#633806" },
  special: { label: "Special rate", bg: "#FCEBEB", text: "#791F1F" },
};

/**
 * @param {object} props
 * @param {string} props.mapboxToken
 * @param {{lat:number,lng:number,address:string}} props.pickup
 * @param {{lat:number,lng:number,address:string}} props.dropoff
 * @param {Date} props.scheduledTime
 * @param {Array} props.fareRules - driver's fare_rules rows
 * @param {number} props.preBookingFee - driver's pre_booking_fee
 * @param {function} props.onConfirm - called with the final fare breakdown when the driver taps confirm
 * @param {function} props.onBack
 */
export default function FareEstimateScreen({
  mapboxToken,
  pickup,
  dropoff,
  scheduledTime,
  fareRules,
  preBookingFee,
  onConfirm,
  onBack,
}) {
  useGoogleFont();
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [route, setRoute] = useState(null);
  const [fare, setFare] = useState(null);
  const [tariffPeriod, setTariffPeriod] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadEstimate() {
      setStatus("loading");
      try {
        const routeResult = await getRoute(pickup, dropoff, mapboxToken);
        if (!routeResult) {
          throw new Error("No route found between these two locations");
        }

        const period = getTariffPeriod(scheduledTime);
        const rule = selectFareRule(fareRules, period);
        if (!rule) {
          throw new Error("This driver hasn't set up pricing yet");
        }

        const fareResult = calculateFare({
          distanceKm: routeResult.distanceKm,
          durationMinutes: routeResult.durationMinutes,
          fareRule: rule,
          preBookingFee,
        });

        if (!cancelled) {
          setRoute(routeResult);
          setTariffPeriod(period);
          setFare(fareResult);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err.message || "Couldn't calculate a fare estimate");
          setStatus("error");
        }
      }
    }

    loadEstimate();
    return () => {
      cancelled = true;
    };
  }, [pickup, dropoff, scheduledTime, fareRules, preBookingFee, mapboxToken]);

  return (
    <div
      className="mx-auto w-full max-w-[400px] p-5"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}
    >
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowRight size={15} color="#5F5E5A" style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">Fare estimate</div>
        <div className="w-9" />
      </div>

      {status === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-[#5F5E5A]">
          <Loader2 size={22} className="animate-spin" color="#185FA5" />
          Calculating your fare…
        </div>
      )}

      {status === "error" && (
        <div
          className="flex flex-col items-center gap-3 rounded-xl p-6 text-center text-sm"
          style={{ background: "#FCEBEB", color: "#791F1F" }}
        >
          <AlertCircle size={22} />
          {errorMessage}
        </div>
      )}

      {status === "ready" && (
        <>
          <div
            className="mb-4 overflow-hidden rounded-xl"
            style={{ border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <LiveMapView
              token={mapboxToken}
              pickup={pickup}
              dropoff={dropoff}
              routeGeometry={route.routeGeometry}
            />
          </div>

          <div
            className="mb-4 flex items-center justify-between rounded-xl px-4 py-3"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <RouteIcon size={13} /> {route.distanceKm} km
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <Clock size={13} /> ~{Math.round(route.durationMinutes)} min
            </div>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ background: TARIFF_LABEL[tariffPeriod].bg, color: TARIFF_LABEL[tariffPeriod].text }}
            >
              {TARIFF_LABEL[tariffPeriod].label}
            </span>
          </div>

          <div
            className="mb-4 rounded-xl p-4"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <div className="mb-3 text-xs font-medium text-[#5F5E5A]">Fare breakdown</div>
            <div className="space-y-2 text-sm text-[#2C2C2A]">
              <div className="flex justify-between"><span>Base fare</span><span>€{fare.baseFare.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Distance ({route.distanceKm} km)</span><span>€{fare.distanceCost.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Time ({Math.round(route.durationMinutes)} min)</span><span>€{fare.timeCost.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Pre-booking fee</span><span>€{fare.preBookingFee.toFixed(2)}</span></div>
            </div>
            {fare.minimumFareApplied && (
              <div className="mt-2 text-[11px] text-[#8C8977]">Minimum fare applied for this trip</div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-[#ECE9E0] pt-3">
              <span className="text-sm font-medium text-[#2C2C2A]">Total</span>
              <span className="text-lg font-semibold text-[#2C2C2A]">€{fare.total.toFixed(2)}</span>
            </div>
          </div>

          <button
            onClick={() => onConfirm({ route, fare, tariffPeriod })}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
            style={{
              background: "linear-gradient(135deg, #378ADD, #0C447C)",
              boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
            }}
          >
            Confirm & pay €{fare.total.toFixed(2)} <ArrowRight size={15} />
          </button>

          <div className="mt-3 text-center text-[11px] text-[#8C8977]">
            Fares reflect current traffic conditions and may differ slightly from the final metered amount.
          </div>
        </>
      )}
    </div>
  );
}

FILE_EOF_2

echo 'Writing src/supabaseClient.js...'
cat > src/supabaseClient.js << 'FILE_EOF_3'
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

FILE_EOF_3

echo 'Writing src/useBookingRealtime.js...'
cat > src/useBookingRealtime.js << 'FILE_EOF_4'
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Subscribes to real-time updates for one booking: its status
 * (pending/confirmed/en_route/arrived/completed/canceled) and the
 * driver's live position, via Supabase Realtime (Postgres Changes).
 *
 * Realtime respects RLS — this only works because of the
 * tracking_select_for_active_customer policy added during the
 * security hardening pass. A customer subscribing to a driver they
 * have no active booking with simply receives nothing, silently,
 * same as a direct query would return zero rows.
 *
 * NOT LIVE-TESTED against a real websocket connection — this sandbox
 * has no network path to Supabase's realtime endpoint. The
 * subscription code follows Supabase's documented Realtime API
 * exactly; the first real test is running this in an actual browser
 * with a real booking.
 *
 * @param {string|null} bookingId - pass null to stay in demo mode
 * @param {string|null} driverId - needed to subscribe to live_tracking
 */
export function useBookingRealtime(bookingId, driverId) {
  const [status, setStatus] = useState("confirmed");
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!bookingId) return; // demo mode — caller manages status itself

    // Get the current status once, immediately, don't wait for the
    // first change event (which might never come if nothing changes).
    supabase
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single()
      .then(({ data }) => {
        if (data) setStatus(data.status);
      });

    const bookingChannel = supabase
      .channel(`booking-status-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => setStatus(payload.new.status)
      )
      .subscribe();

    let trackingChannel;
    if (driverId) {
      supabase
        .from("live_tracking")
        .select("lat, lng")
        .eq("driver_id", driverId)
        .single()
        .then(({ data }) => {
          if (data) setPosition(data);
        });

      trackingChannel = supabase
        .channel(`driver-position-${driverId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "live_tracking", filter: `driver_id=eq.${driverId}` },
          (payload) => setPosition({ lat: payload.new.lat, lng: payload.new.lng })
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(bookingChannel);
      if (trackingChannel) supabase.removeChannel(trackingChannel);
    };
  }, [bookingId, driverId]);

  return { status, position };
}

FILE_EOF_4

echo 'Staging and committing...'
git add -A
git commit -m 'Bigger touch targets; add Supabase client and real-time booking status hook'

echo 'Pushing to GitHub...'
git push origin main

echo 'Done.'