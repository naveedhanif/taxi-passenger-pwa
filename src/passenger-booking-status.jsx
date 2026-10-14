import { useEffect, useRef, useState, useCallback } from "react";
import { isIosStandalone } from "./iosStandalone.js";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Calendar, Clock, ArrowLeft, Car, CheckCircle2, Phone, MessageCircle, MessageSquare, X, Loader2, AlertCircle, Star, HeartHandshake, Share2, Check, Plane } from "lucide-react";
import { getBookingStatus, cancelBooking } from "./bookingStatusApi.js";
import ModifyBookingScreen from "./ModifyBookingScreen.jsx";
import { submitReview } from "./reviewApi.js";
import { createTipPayment } from "./tipApi.js";
import TipPaymentForm from "./TipPaymentForm.jsx";
import { formatPhoneForLinks } from "./phoneLinks.js";
import { supabase } from "./supabaseClient.js";
import ChatPanel from "./ChatPanel.jsx";

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

// How often the live ETA is recalculated. Each recalculation is one
// Mapbox Directions request, so this is deliberately slow (the car moves
// every 8s, but an ETA that changes every 8s is noise AND cost).
const ETA_REFRESH_MS = 60000;

// A position older than this is shown as "last seen", not "live" — e.g.
// the driver switched to Google Maps and this app was backgrounded.
const STALE_AFTER_SECONDS = 45;

function useTick(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Minutes until the driver reaches the pickup, from real road routing.
 * Only runs while the driver is en route AND has a real position, and
 * refreshes at most once per ETA_REFRESH_MS. Returns null whenever it
 * can't honestly say (no position, request failed) — never a guess.
 */
function useDriverEta({ position, pickup, status }) {
  const [etaMinutes, setEtaMinutes] = useState(null);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    if (status !== "en_route" || !position || !pickup || !mapboxgl.accessToken) {
      setEtaMinutes(null);
      return;
    }
    if (Date.now() - lastFetchRef.current < ETA_REFRESH_MS) return;
    lastFetchRef.current = Date.now();

    // Deliberately NOT aborted when the position updates mid-request: the
    // 60s throttle above would then block a retry and the ETA would never
    // appear.
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${position.lng},${position.lat};${pickup.lng},${pickup.lat}` +
      `?overview=false&access_token=${mapboxgl.accessToken}`;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        const seconds = json?.routes?.[0]?.duration;
        if (typeof seconds === "number") setEtaMinutes(Math.max(1, Math.round(seconds / 60)));
        else console.error("useDriverEta: no route in Directions response", json?.message || json);
      })
      .catch((err) => console.error("useDriverEta: Directions request failed:", err));
  }, [status, position?.lat, position?.lng, pickup?.lat, pickup?.lng]);

  return etaMinutes;
}

function formatAgo(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s ago`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min ago` : "over an hour ago";
}

function LiveTrackingMap({ pickup, dropoff, status, livePosition }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const mapLoadedRef = useRef(false);
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
        paint: { "line-color": "#111111", "line-width": 3, "line-dasharray": [0.3, 1.6] },
      });

      new mapboxgl.Marker({ color: "#639922" }).setLngLat(pickupLngLat).addTo(map);
      new mapboxgl.Marker({ color: "#A32D2D" }).setLngLat(dropoffLngLat).addTo(map);

      mapLoadedRef.current = true;
      syncDriverMarker();
      map.fitBounds(
        livePosition
          ? [pickupLngLat, dropoffLngLat, [livePosition.lng, livePosition.lat]]
          : [pickupLngLat, dropoffLngLat],
        { padding: 50, duration: 0 }
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
      driverMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingToken]);

  // Shows the car ONLY at a real, server-confirmed position. Previously a
  // fake "estimated" marker was drawn when no position existed — misleading
  // now that real tracking exists, so with no data there is simply no car.
  function syncDriverMarker() {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    if (!livePosition) {
      if (driverMarkerRef.current) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      return;
    }

    const pos = [livePosition.lng, livePosition.lat];
    if (!driverMarkerRef.current) {
      const el = document.createElement("div");
      el.style.width = "34px";
      el.style.height = "34px";
      el.style.borderRadius = "50%";
      el.style.background = "linear-gradient(155deg, #FFFFFF, #E7E5DD)";
      el.style.boxShadow = "var(--shadow-btn)";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111111" stroke-width="2"><path d="M5 17h14M5 17a2 2 0 100 4 2 2 0 000-4zm14 0a2 2 0 100 4 2 2 0 000-4zM5 17l1.5-6h11L19 17M6.5 11l1-3h9l1 3"/></svg>';
      driverMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat(pos).addTo(map);
      map.fitBounds([pickupLngLat, dropoffLngLat, pos], { padding: 50, duration: 600 });
    } else {
      driverMarkerRef.current.setLngLat(pos);
      // Re-frame only if the car has driven out of view, so the map
      // doesn't jump around on every 8-second update.
      if (!map.getBounds().contains(pos)) {
        map.fitBounds([pickupLngLat, dropoffLngLat, pos], { padding: 50, duration: 600 });
      }
    }
  }

  // Move/create/remove the driver marker whenever a fresh position comes in
  useEffect(() => {
    syncDriverMarker();
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
        boxShadow: "var(--shadow-raised)",
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
export default function BookingStatus({ bookingId, guestAccessToken, customerSessionToken, isSharedView = false, onBack, onBookAgain, autoOpenChat = false, onAutoOpenChatConsumed, onChatOpenChange }) {
  useGoogleFont();
  const [data, setData] = useState(null); // { booking, driver, vehicle, position }
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [canceling, setCanceling] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const pollRef = useRef(null);
  // Whether this exact booking already got a rating submitted — checked
  // against localStorage so a reload after rating doesn't re-show the
  // prompt (the server also independently rejects a duplicate review,
  // this is purely so the UI doesn't ask twice).
  const [hasRated, setHasRated] = useState(() => {
    try {
      return localStorage.getItem(`taxi_reviewed_${bookingId}`) === "1";
    } catch {
      return false;
    }
  });
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingHover, setRatingHover] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState("");
  // Tipping — separate from rating, a passenger can tip without rating
  // or vice versa. tipAmountPaid tracks the actual confirmed amount
  // (not just "did they tip"), persisted so a reload doesn't re-show
  // the prompt after a tip already went through.
  const [tipAmountPaid, setTipAmountPaid] = useState(() => {
    try {
      const saved = localStorage.getItem(`taxi_tip_${bookingId}`);
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  const [tipChoice, setTipChoice] = useState(null); // number | "custom" | "skip" | null
  const [customTipInput, setCustomTipInput] = useState("");
  const [tipClientSecret, setTipClientSecret] = useState(null);
  const [creatingTipIntent, setCreatingTipIntent] = useState(false);
  const [tipSetupError, setTipSetupError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  // Chat now lives behind a tap-to-open bottom sheet instead of always
  // being expanded inline — keeps the main tracking screen focused,
  // matching the reference layout. ChatPanel itself stays mounted at
  // all times regardless of chatOpen (see the render below) so its 6s
  // poll — and the sound/vibrate it triggers — keeps running even
  // while the sheet is visually closed.
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    onChatOpenChange?.(chatOpen);
    // If this whole screen unmounts while chat happens to be open
    // (navigating away via a different route), make sure the parent's
    // nav-hiding state doesn't stay stuck permanently hidden.
    return () => onChatOpenChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen]);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  useEffect(() => {
    if (autoOpenChat) {
      setChatOpen(true);
      onAutoOpenChatConsumed?.();
    }
    // Only ever fires once, right when arriving from a chat-message
    // notification — onAutoOpenChatConsumed resets the flag in the
    // parent immediately, so this can't re-trigger and force chat back
    // open every time the passenger closes it manually afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenChat]);

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
    // Kept running even with Realtime below, as a fallback — same
    // reasoning as the top-level watcher in App.jsx.
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);

    let channel;
    if (bookingId) {
      channel = supabase
        .channel(`booking-status-detail-${bookingId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
          () => load()
        )
        .subscribe();
    }

    return () => {
      clearInterval(pollRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load, bookingId]);

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

  async function handleSubmitRating() {
    if (ratingValue < 1) return;
    setSubmittingRating(true);
    setRatingError("");
    const result = await submitReview({
      bookingId,
      guestAccessToken,
      customerSessionToken,
      rating: ratingValue,
      comment: ratingComment,
    });
    setSubmittingRating(false);
    if (result.error) {
      setRatingError(result.error);
      return;
    }
    setHasRated(true);
    try {
      localStorage.setItem(`taxi_reviewed_${bookingId}`, "1");
    } catch {
      // Ignore — worst case the prompt could reappear on a future
      // reload, and the server will just reject the duplicate cleanly.
    }
  }

  async function handleChooseTipAmount(amount) {
    setTipSetupError("");
    setCreatingTipIntent(true);
    const result = await createTipPayment({ bookingId, guestAccessToken, customerSessionToken, amount });
    setCreatingTipIntent(false);
    if (result.error) {
      setTipSetupError(result.error);
      return;
    }
    setTipClientSecret(result.clientSecret);
  }

  function handleTipSuccess(amount) {
    setTipAmountPaid(amount);
    try {
      localStorage.setItem(`taxi_tip_${bookingId}`, String(amount));
    } catch {
      // Ignore.
    }
  }

  async function handleShareTrip() {
    if (!guestAccessToken) return;
    // Reuses the app's own existing guest-access-token mechanism —
    // get-booking-status already treats a matching access_token as
    // valid proof of ownership for read access, so this link just
    // hands that same proof to whoever it's shared with. Same origin/
    // pathname (driver slug) as the current page, with track/token
    // added — App.jsx's driver-lookup effect watches for exactly this
    // shape and jumps straight to a read-only status view.
    const shareUrl = `${window.location.origin}${window.location.pathname}?track=${bookingId}&token=${guestAccessToken}`;
    const shareText = `Track my taxi trip with ${driver?.businessName || "my driver"}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Trip tracking", text: shareText, url: shareUrl });
        return;
      } catch {
        // User cancelled the native share sheet, or it's unsupported for
        // this content — fall through to clipboard copy instead.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      window.prompt("Copy this link to share your trip:", shareUrl);
    }
  }

  // Hooks must run on every render, before any early return below.
  const nowTick = useTick(5000);
  const etaMinutes = useDriverEta({
    position: data?.position ?? null,
    pickup: data?.booking?.pickup ?? null,
    status: data?.booking?.status,
  });

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
          style={{ background: "#F0EEE7", boxShadow: "var(--shadow-btn)" }}
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
          style={{ background: "#F0EEE7", boxShadow: "var(--shadow-btn)" }}
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="text-sm font-semibold text-[#2C2C2A]">{isSharedView ? "Shared trip" : "Your booking"}</div>
        <div className="flex w-9 justify-end">
          {!isSharedView && guestAccessToken && (
            <button
              onClick={handleShareTrip}
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: "#F0EEE7", boxShadow: "var(--shadow-btn)" }}
              aria-label="Share trip"
              title="Share this trip with someone"
            >
              {shareCopied ? <Check size={14} color="#27500A" /> : <Share2 size={14} color="#5F5E5A" />}
            </button>
          )}
        </div>
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
                boxShadow: "var(--shadow-btn)",
              }}
            >
              <Car size={18} color="var(--accent)" />
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
                <div className="h-2 w-2 rounded-full" style={{ background: i <= stageIndex ? "var(--accent)" : "#D3D1C7" }} />
                {i < STAGES.length - 1 && (
                  <div className="mx-1 h-0.5 flex-1" style={{ background: i < stageIndex ? "var(--accent)" : "#D3D1C7" }} />
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
            {(() => {
              // Honest states only: a live ETA when we have a real
              // position, "last seen" when it has gone quiet, and a plain
              // waiting message when there's no position at all.
              const ageSeconds = position?.updatedAt ? Math.max(0, (nowTick - new Date(position.updatedAt).getTime()) / 1000) : null;
              const isStale = ageSeconds != null && ageSeconds > STALE_AFTER_SECONDS;
              let label;
              if (!position) {
                label = status === "en_route" ? "Waiting for driver's location…" : "Driver hasn't set off yet";
              } else if (status === "arrived") {
                label = "Driver is at the pickup point";
              } else if (isStale) {
                label = `Last seen ${formatAgo(ageSeconds)}`;
              } else if (etaMinutes != null) {
                label = `Arriving in ~${etaMinutes} min`;
              } else {
                label = "Live";
              }
              return (
                <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-[#2C2C2A] shadow-sm">
                  {position && !isStale && <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#639922" }} />}
                  {label}
                </div>
              );
            })()}
          </div>
        </EmbossCard>
      )}

      {/* Driver card */}
      {driver.businessName && (
        <EmbossCard className="mb-4 flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white"
              style={{ background: "var(--accent-gradient)" }}
            >
              {driver.photoUrl ? (
                <img src={driver.photoUrl} alt={driver.businessName} className="h-full w-full object-cover" />
              ) : (
                driver.businessName.charAt(0)
              )}
            </div>
            <div>
              <div className="text-sm font-medium text-[#2C2C2A]">{driver.businessName}</div>
              <div className="text-xs text-[#5F5E5A]">
                {vehicle ? `${vehicle.make} ${vehicle.model} · ${vehicle.color}` : "Vehicle details unavailable"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isDone && !isCanceled && !isSharedView && (
              <button
                onClick={() => {
                  setChatOpen(true);
                  setHasUnreadChat(false);
                }}
                className="relative flex h-11 w-11 items-center justify-center rounded-full"
                style={{ background: "var(--accent-gradient)" }}
                aria-label="Chat with driver"
              >
                <MessageSquare size={14} color="#FFFFFF" />
                {hasUnreadChat && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#FBFAF6]"
                    style={{ background: "#D9534F" }}
                  />
                )}
              </button>
            )}
            {phoneLinks && (
              <>
                <a
                  href={`tel:${phoneLinks.tel}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: "#F0EEE7", boxShadow: "var(--shadow-btn)" }}
                  aria-label="Call driver"
                >
                  <Phone size={14} color="var(--accent)" />
                </a>
                <a
                  href={`https://wa.me/${phoneLinks.whatsapp}`}
                  {...(isIosStandalone() ? {} : { target: "_blank", rel: "noreferrer" })}
                  className="flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: "#25D366" }}
                  aria-label="WhatsApp driver"
                >
                  <MessageCircle size={14} color="#FFFFFF" />
                </a>
              </>
            )}
          </div>
        </EmbossCard>
      )}

      {/* In-app chat now lives in a tap-to-open bottom sheet (triggered
          by the chat icon in the driver card above) instead of being
          permanently expanded here — see the sheet render near the end
          of this component. ChatPanel is mounted unconditionally there
          (not just when the sheet is open) so its polling — and the
          sound/vibrate/unread-dot it can trigger — keeps working
          whether or not the passenger currently has the sheet open. */}

      {/* Flight status — only real data, only shown if a flight number
          was actually given at booking time. flightStatus/flightRevisedArrival
          come straight from get-booking-status, sourced from the real
          AeroDataBox lookup (see _shared/flightStatus.ts), never fabricated. */}
      {booking.flightNumber && (
        <EmbossCard className="mb-4 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[#5F5E5A]">
            <Plane size={13} /> Flight {booking.flightNumber}
          </div>
          {booking.flightStatus ? (
            <>
              <div className="text-sm font-semibold text-[#2C2C2A]">{booking.flightStatus}</div>
              {booking.flightRevisedArrival && booking.flightScheduledArrival && booking.flightRevisedArrival !== booking.flightScheduledArrival && (
                <div className="mt-1 text-[11px]" style={{ color: "#633806" }}>
                  Revised arrival: {new Date(booking.flightRevisedArrival).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  {" "}(was {new Date(booking.flightScheduledArrival).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })})
                  — your pickup time has been adjusted to match.
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-[#8C8977]">We'll check this flight's status closer to your pickup time.</div>
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
          {(booking.stops || []).map((stop, i) => (
            <div key={i} className="flex items-start gap-2">
              <MapPin size={14} color="#B4772E" className="mt-0.5" />
              <div>
                <div className="text-[#2C2C2A]">{stop.address}</div>
                <div className="text-[11px] text-[#8C8977]">Stop {i + 1}</div>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2">
            <MapPin size={14} color="var(--accent)" className="mt-0.5" />
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

      {isDone && !hasRated && !isSharedView && (
        <EmbossCard className="mb-4 p-5">
          <div className="mb-3 text-center text-sm font-semibold text-[#2C2C2A]">
            How was your trip with {driver.businessName || "your driver"}?
          </div>
          <div className="mb-3 flex justify-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRatingValue(n)}
                onMouseEnter={() => setRatingHover(n)}
                onMouseLeave={() => setRatingHover(0)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
              >
                <Star
                  size={30}
                  fill={(ratingHover || ratingValue) >= n ? "#F5B300" : "none"}
                  color={(ratingHover || ratingValue) >= n ? "#F5B300" : "#D3D1C7"}
                  strokeWidth={1.5}
                />
              </button>
            ))}
          </div>
          {ratingValue > 0 && (
            <>
              <textarea
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Add a comment (optional)"
                rows={2}
                className="mb-3 w-full rounded-lg p-3 text-sm text-[#2C2C2A] placeholder:text-[#B4B2A9]"
                style={{ background: "#F1EFE8", border: "1px solid #ECE9E0" }}
              />
              {ratingError && (
                <div className="mb-3 flex items-center gap-1.5 rounded-lg p-2 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                  <AlertCircle size={12} /> {ratingError}
                </div>
              )}
              <button
                onClick={handleSubmitRating}
                disabled={submittingRating}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--accent-gradient)" }}
              >
                {submittingRating ? <Loader2 size={15} className="animate-spin" /> : null}
                {submittingRating ? "Submitting…" : "Submit rating"}
              </button>
            </>
          )}
        </EmbossCard>
      )}

      {isDone && hasRated && (
        <div className="mb-4 flex items-center justify-center gap-1.5 rounded-xl p-3 text-sm font-medium" style={{ background: "#EAF3DE", color: "#27500A" }}>
          <CheckCircle2 size={15} /> Thanks for your rating!
        </div>
      )}

      {isDone && tipAmountPaid == null && tipChoice !== "skip" && !isSharedView && (
        <EmbossCard className="mb-4 p-5">
          <div className="mb-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-[#2C2C2A]">
            <HeartHandshake size={16} color="var(--accent)" /> Add a tip?
          </div>
          <div className="mb-3 text-center text-xs text-[#8C8977]">100% goes directly to your driver.</div>

          {!tipClientSecret ? (
            <>
              <div className="mb-3 grid grid-cols-4 gap-2">
                {[2, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setTipChoice(n);
                      handleChooseTipAmount(n);
                    }}
                    disabled={creatingTipIntent}
                    className="rounded-lg py-2.5 text-sm font-semibold text-[#2C2C2A] disabled:opacity-60"
                    style={{ background: tipChoice === n ? "#FFF3C4" : "#F1EFE8" }}
                  >
                    €{n}
                  </button>
                ))}
                <button
                  onClick={() => setTipChoice("custom")}
                  disabled={creatingTipIntent}
                  className="rounded-lg py-2.5 text-xs font-semibold text-[#2C2C2A] disabled:opacity-60"
                  style={{ background: tipChoice === "custom" ? "#FFF3C4" : "#F1EFE8" }}
                >
                  Other
                </button>
              </div>
              {tipChoice === "custom" && (
                <div className="mb-3 flex gap-2">
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={customTipInput}
                    onChange={(e) => setCustomTipInput(e.target.value)}
                    placeholder="Amount in €"
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm text-[#2C2C2A]"
                    style={{ background: "#F1EFE8", border: "1px solid #ECE9E0" }}
                  />
                  <button
                    onClick={() => handleChooseTipAmount(Number(customTipInput))}
                    disabled={!customTipInput || Number(customTipInput) <= 0 || creatingTipIntent}
                    className="rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--accent-gradient)" }}
                  >
                    Go
                  </button>
                </div>
              )}
              {creatingTipIntent && (
                <div className="mb-2 flex items-center justify-center gap-1.5 text-xs text-[#5F5E5A]">
                  <Loader2 size={12} className="animate-spin" /> Setting up…
                </div>
              )}
              {tipSetupError && (
                <div className="mb-2 flex items-center gap-1.5 rounded-lg p-2 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                  <AlertCircle size={12} /> {tipSetupError}
                </div>
              )}
              <button onClick={() => setTipChoice("skip")} className="block w-full text-center text-xs text-[#B4B2A9] underline">
                No thanks
              </button>
            </>
          ) : (
            <TipPaymentForm
              stripePublishableKey={import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY}
              clientSecret={tipClientSecret}
              bookingId={bookingId}
              onSuccess={handleTipSuccess}
            />
          )}
        </EmbossCard>
      )}

      {isDone && tipAmountPaid != null && (
        <div className="mb-4 flex items-center justify-center gap-1.5 rounded-xl p-3 text-sm font-medium" style={{ background: "#EAF3DE", color: "#27500A" }}>
          <HeartHandshake size={15} /> €{tipAmountPaid.toFixed(2)} tip sent — thank you!
        </div>
      )}

      {isDone ? (
        <button
          onClick={onBookAgain}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
          style={{
            background: "var(--accent-gradient)",
            boxShadow: "var(--shadow-accent-btn)",
          }}
        >
          Book {driver.businessName || "again"}
        </button>
      ) : isCanceled ? (
        <button
          onClick={onBookAgain}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
          style={{
            background: "var(--accent-gradient)",
            boxShadow: "var(--shadow-accent-btn)",
          }}
        >
          Back to home
        </button>
      ) : booking.selfCancelable && !isSharedView ? (
        <div className="space-y-2">
          <button
            onClick={() => setModifyOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium"
            style={{ background: "var(--bg-card-alt)", color: "var(--accent)", boxShadow: "var(--shadow-btn)" }}
          >
            Modify booking
          </button>
          <button
            onClick={handleCancel}
            disabled={canceling}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium disabled:opacity-60"
            style={{
              background: "var(--bg-card-alt)",
              color: "var(--error-text)",
              boxShadow: "var(--shadow-btn)",
            }}
          >
            <X size={14} /> {canceling ? "Cancelling…" : "Cancel booking"}
          </button>
        </div>
      ) : isSharedView ? (
        <div className="text-center text-xs text-[#8C8977]">You're viewing a shared trip.</div>
      ) : phoneLinks ? (
        <div className="text-center text-xs text-[#8C8977]">
          Your driver is already on the way — contact them directly above to cancel.
        </div>
      ) : null}

      {/* Chat bottom sheet — ChatPanel is mounted unconditionally
          whenever the trip is active, regardless of chatOpen, purely so
          its 6s poll (and the sound/vibrate/unread-dot it triggers)
          keeps running while the sheet is visually closed. Only the
          sheet's position/opacity/backdrop respond to chatOpen. */}
      {!isDone && !isCanceled && !isSharedView && (
        <>
          <div
            onClick={() => setChatOpen(false)}
            className="fixed inset-0 z-40 bg-black/40"
            style={{
              opacity: chatOpen ? 1 : 0,
              pointerEvents: chatOpen ? "auto" : "none",
              transition: "opacity 200ms ease",
            }}
            aria-hidden={!chatOpen}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-[400px] flex-col rounded-t-2xl"
            style={{
              background: "#F7F7F5",
              boxShadow: "0 -8px 24px rgba(44,44,42,0.18)",
              maxHeight: "80vh",
              transform: chatOpen ? "translateY(0)" : "translateY(100%)",
              transition: "transform 260ms ease",
            }}
            role="dialog"
            aria-label="Chat with driver"
            aria-hidden={!chatOpen}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full" style={{ background: "#E4E2DA" }} />
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#2C2C2A]">
                <MessageSquare size={15} color="var(--accent)" />
                Chat with {driver?.businessName || "your driver"}
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: "#F0EEE7" }}
                aria-label="Close chat"
              >
                <X size={14} color="#5F5E5A" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <ChatPanel
                bookingId={bookingId}
                guestAccessToken={guestAccessToken}
                customerSessionToken={customerSessionToken}
                selfRole="passenger"
                hideHeader
                maxListHeight="55vh"
                onNewMessage={() => {
                  // Only flag unread if the sheet isn't the thing the
                  // passenger is already looking at.
                  if (!chatOpenRef.current) setHasUnreadChat(true);
                }}
              />
            </div>
          </div>
        </>
      )}

      {modifyOpen && (
        <ModifyBookingScreen
          booking={booking}
          bookingId={bookingId}
          guestAccessToken={guestAccessToken}
          customerSessionToken={customerSessionToken}
          mapboxToken={import.meta.env.VITE_MAPBOX_TOKEN || ""}
          onClose={() => setModifyOpen(false)}
          onModified={() => {
            setModifyOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
