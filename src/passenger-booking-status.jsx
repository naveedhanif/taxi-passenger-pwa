import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Calendar, Clock, ArrowLeft, Car, CheckCircle2, Phone, MessageCircle, X, Loader2, AlertCircle } from "lucide-react";
import { getBookingStatus, cancelBooking } from "./bookingStatusApi.js";
import { formatPhoneForLinks } from "./phoneLinks.js";

// Requires: npm install mapbox-gl
// Requires: a Mapbox access token in your .env as VITE_MAPBOX_TOKEN
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

// How often to re-check the booking's status/position while this screen
// is open. Realtime (websocket push) would be snappier, but that needs
// an RLS policy on `bookings`/`live_tracking` proven to permit guest
// reads by access_token, which isn't confirmed to exist yet — polling
// via the authorized get-booking-status function works correctly right
// now regardless of that, at the cost of up-to-~8s staleness instead of
// instant. Fine to swap for the useBookingRealtime.js hook later once
// that policy is verified live.
const POLL_INTERVAL_MS = 8000;

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Fallback driver-position estimate for stages before the driver has an
// actual live_tracking row yet — interpolated along a straight line
// toward pickup so the map isn't empty. Once a real `position` comes
// back from the server this is ignored entirely.
const PROGRESS_ESTIMATE = { pending: 0, confirmed: 0, en_route: 0.55, arrived: 1, in_progress: 1, completed: 1, canceled: 0 };

function LiveTrackingMap({ pickup, dropoff, status, livePosition }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const [missingToken] = useState(!mapboxgl.accessToken);

  const pickupLngLat = [pickup.lng, pickup.lat];
  const dropoffLngLat = [dropoff.lng, dropoff.lat];

  useEffect(() => {
    if (missingToken || !containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: pickupLngLat,
      zoom: 12,
      attributionControl: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Straight-line route placeholder — swap for a real Mapbox
      // Directions API call (already used server-side in create-booking)
      // to draw the actual road route instead of a straight line.
      map.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [pickupLngLat, dropoffLngLat] } },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#185FA5", "line-width": 3, "line-dasharray": [0.3, 1.6] },
      });

      new mapboxgl.Marker({ color: "#639922" }).setLngLat(pickupLngLat).addTo(map);
      new mapboxgl.Marker({ color: "#A32D2D" }).setLngLat(dropoffLngLat).addTo(map);

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

      const startPos = livePosition
        ? [livePosition.lng, livePosition.lat]
        : lerp(dropoffLngLat, pickupLngLat, 1 - (PROGRESS_ESTIMATE[status] ?? 0));
      driverMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(startPos).addTo(map);

      map.fitBounds([pickupLngLat, dropoffLngLat, startPos], { padding: 50, duration: 0 });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingToken]);

  // Move the driver marker whenever a fresh position/status comes in from polling
  useEffect(() => {
    if (!driverMarkerRef.current) return;
    const pos = livePosition
      ? [livePosition.lng, livePosition.lat]
      : lerp(dropoffLngLat, pickupLngLat, 1 - (PROGRESS_ESTIMATE[status] ?? 0));
    driverMarkerRef.current.setLngLat(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, livePosition?.lat, livePosition?.lng]);

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
  pending: "Awaiting driver confirmation",
  confirmed: "Confirmed",
  en_route: "En route",
  arrived: "Driver has arrived",
  in_progress: "Trip in progress",
  completed: "Trip completed",
  canceled: "Booking canceled",
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

/**
 * @param {object} props
 * @param {string} props.bookingId - required; the real booking to track
 * @param {string|null} [props.guestAccessToken] - required for a guest passenger; the token createBooking returned
 * @param {string|null} [props.customerSessionToken] - required for a signed-in customer instead of guestAccessToken
 * @param {function} props.onBack
 * @param {function} [props.onBookAgain]
 */
export default function BookingStatus({ bookingId, guestAccessToken, customerSessionToken, onBack, onBookAgain }) {
  useGoogleFont();
  const [data, setData] = useState(null); // { booking, driver, vehicle, position }
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    if (!bookingId) return;
    const result = await getBookingStatus({ bookingId, guestAccessToken, customerSessionToken });
    if (result.error) {
      setLoadError(result.error);
    } else {
      setLoadError("");
      setData(result);
    }
    setLoading(false);
  }, [bookingId, guestAccessToken, customerSessionToken]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [load]);

  async function handleCancel() {
    if (!window.confirm("Cancel this booking? This can't be undone.")) return;
    setCanceling(true);
    const result = await cancelBooking({ bookingId, guestAccessToken, customerSessionToken });
    setCanceling(false);
    if (result.error) {
      window.alert(result.error);
      return;
    }
    if (result.refundError) {
      // The cancellation itself succeeded but the refund didn't go
      // through automatically — worth surfacing loudly rather than
      // silently, since real money is stuck.
      window.alert(
        "Your booking is cancelled, but the automatic refund failed. Please contact your driver or the platform for a manual refund."
      );
    }
    load();
  }

  if (!bookingId) {
    return (
      <div className="mx-auto w-full max-w-[400px] p-10 text-center text-sm text-[#8C8977]">
        No booking to show yet — book a ride first.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-[400px] items-center justify-center gap-2 p-10 text-sm text-[#5F5E5A]">
        <Loader2 size={16} className="animate-spin" /> Loading your booking…
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="mx-auto w-full max-w-[400px] p-5" style={{ fontFamily: "Inter" }}>
        <button
          onClick={onBack}
          className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="flex items-center gap-2 rounded-xl p-4 text-sm" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={16} /> {loadError || "Couldn't load this booking"}
        </div>
      </div>
    );
  }

  const { booking, driver, vehicle, position } = data;
  const status = booking.status;
  const stageIndex = STAGES.indexOf(status);
  const isDone = status === "completed";
  const isCanceled = status === "canceled";
  const phoneLinks = formatPhoneForLinks(driver.phoneNumber);
  const scheduledDate = new Date(booking.scheduledTime);

  return (
    <div
      className="mx-auto w-full max-w-[400px] p-5"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 700 }}
    >
      {/* Top bar */}
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">Your booking</div>
        <div className="w-9" />
      </div>

      {/* Status banner */}
      <EmbossCard className="mb-4 p-5">
        <div className="flex items-center gap-3">
          {isDone ? (
            <CheckCircle2 size={22} color="#639922" />
          ) : isCanceled ? (
            <X size={22} color="#791F1F" />
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
            <div className="text-base font-semibold text-[#2C2C2A]">{STAGE_LABEL[status] || status}</div>
            {isCanceled ? (
              <div className="text-xs" style={{ color: booking.refunded ? "#3B6D11" : "#5F5E5A" }}>
                {booking.refunded
                  ? "Your refund is on the way — it can take a few days to appear on your statement."
                  : "This booking was cancelled."}
              </div>
            ) : (
              driver.businessName && (
                <div className="text-xs text-[#5F5E5A]">
                  {status === "en_route" ? `${driver.businessName} is heading to your pickup location` :
                   status === "arrived" ? "Your driver is waiting outside" :
                   status === "completed" ? `Thanks for riding with ${driver.businessName}` :
                   `${driver.businessName} will be on their way closer to pickup time`}
                </div>
              )
            )}
          </div>
        </div>

        {!isCanceled && (
          <div className="mt-4 flex items-center">
            {STAGES.map((s, i) => (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <div className="h-2 w-2 rounded-full" style={{ background: i <= stageIndex ? "#185FA5" : "#D3D1C7" }} />
                {i < STAGES.length - 1 && (
                  <div className="mx-1 h-0.5 flex-1" style={{ background: i < stageIndex ? "#185FA5" : "#D3D1C7" }} />
                )}
              </div>
            ))}
          </div>
        )}
      </EmbossCard>

      {/* Live map */}
      {!isDone && !isCanceled && (
        <EmbossCard className="mb-4 overflow-hidden">
          <div className="relative">
            <LiveTrackingMap pickup={booking.pickup} dropoff={booking.dropoff} status={status} livePosition={position} />
            {!position && (
              <div className="absolute bottom-3 right-3 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-[#2C2C2A] shadow-sm">
                {status === "en_route" ? "On the way" : "Not yet en route"}
              </div>
            )}
          </div>
        </EmbossCard>
      )}

      {/* Driver card */}
      {driver.businessName && (
        <EmbossCard className="mb-4 flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
            >
              {driver.businessName.charAt(0)}
            </div>
            <div>
              <div className="text-sm font-medium text-[#2C2C2A]">{driver.businessName}</div>
              <div className="text-xs text-[#5F5E5A]">
                {vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.color}` : "Vehicle details unavailable"}
              </div>
            </div>
          </div>
          {phoneLinks && (
            <div className="flex gap-2">
              <a
                href={`tel:${phoneLinks.tel}`}
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
                aria-label="Call driver"
              >
                <Phone size={14} color="#185FA5" />
              </a>
              <a
                href={`https://wa.me/${phoneLinks.whatsapp}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 w-11 items-center justify-center rounded-full"
                style={{ background: "#25D366" }}
                aria-label="WhatsApp driver"
              >
                <MessageCircle size={14} color="#FFFFFF" />
              </a>
            </div>
          )}
        </EmbossCard>
      )}

      {/* Trip details */}
      <EmbossCard className="mb-4 p-4">
        <div className="mb-3 text-xs font-medium text-[#5F5E5A]">Trip details</div>
        <div className="space-y-2.5 text-sm">
          <div className="flex items-start gap-2">
            <MapPin size={14} color="#8C8977" className="mt-0.5" />
            <div>
              <div className="text-[#2C2C2A]">{booking.pickup.address}</div>
              <div className="text-[11px] text-[#8C8977]">Pickup</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={14} color="#185FA5" className="mt-0.5" />
            <div>
              <div className="text-[#2C2C2A]">{booking.dropoff.address}</div>
              <div className="text-[11px] text-[#8C8977]">Drop-off</div>
            </div>
          </div>
          <div className="flex items-center gap-4 pt-1.5">
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <Calendar size={12} /> {scheduledDate.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#5F5E5A]">
              <Clock size={12} /> {scheduledDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#ECE9E0] pt-3">
          <span className="text-xs text-[#5F5E5A]">{booking.isFinalFare ? "Total charged" : "Estimated fare"}</span>
          <span className="text-base font-semibold text-[#2C2C2A]">€{Number(booking.fare).toFixed(2)}</span>
        </div>
        {booking.paymentTiming === "later" && booking.balanceDue != null && !isDone && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-[#5F5E5A]">Balance due after the ride</span>
            <span className="text-sm font-medium text-[#633806]">€{Number(booking.balanceDue).toFixed(2)}</span>
          </div>
        )}
      </EmbossCard>

      {isDone ? (
        <button
          onClick={onBookAgain}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
          style={{
            background: "linear-gradient(135deg, #378ADD, #0C447C)",
            boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
          }}
        >
          Book {driver.businessName || "again"}
        </button>
      ) : isCanceled ? (
        <button
          onClick={onBookAgain}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
          style={{
            background: "linear-gradient(135deg, #378ADD, #0C447C)",
            boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
          }}
        >
          Back to home
        </button>
      ) : booking.selfCancelable ? (
        <button
          onClick={handleCancel}
          disabled={canceling}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium disabled:opacity-60"
          style={{
            background: "#F0EEE7",
            color: "#A32D2D",
            boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)",
          }}
        >
          <X size={14} /> {canceling ? "Cancelling…" : "Cancel booking"}
        </button>
      ) : phoneLinks ? (
        <div className="text-center text-xs text-[#8C8977]">
          Your driver is already on the way — contact them directly above to cancel.
        </div>
      ) : null}
    </div>
  );
}
