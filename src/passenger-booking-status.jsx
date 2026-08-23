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

