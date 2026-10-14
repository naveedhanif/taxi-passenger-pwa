import { useEffect, useState } from "react";
import { ArrowLeft, Star, Car, Users, ShieldCheck, MessageSquareQuote, Loader2, AlertCircle } from "lucide-react";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

function StarRow({ rating, size = 14 }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} fill={n <= rating ? "#FFC400" : "none"} color={n <= rating ? "#FFC400" : "#D3D1C7"} strokeWidth={1.5} />
      ))}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.driverId
 * @param {string} props.businessName
 * @param {string|null} props.driverPhotoUrl
 * @param {string|null} props.vehiclePhotoUrl
 * @param {object|null} props.vehicle - {make, model, color, seats}
 * @param {number|null} props.avgRating
 * @param {number} props.reviewCount
 * @param {boolean} props.licenceVerified
 * @param {function} props.onBack
 */
export default function DriverProfileScreen({
  driverId,
  businessName,
  driverPhotoUrl,
  vehiclePhotoUrl,
  vehicle,
  avgRating,
  reviewCount,
  licenceVerified,
  onBack,
}) {
  useGoogleFont();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    (async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/get-public-reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
        body: JSON.stringify({ driver_id: driverId }),
      });
      const data = await res.json();
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setErrorMessage(data.error || "Couldn't load reviews");
        return;
      }
      setReviews(data.reviews || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [driverId]);

  return (
    <div className="mx-auto w-full max-w-[430px] p-5" style={{ fontFamily: "Inter" }}>
      <button
        onClick={onBack}
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
      >
        <ArrowLeft size={15} color="var(--text-secondary)" />
      </button>

      <div className="mb-5 flex flex-col items-center text-center">
        <div
          className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full"
          style={{ background: "var(--bg-card-alt)", boxShadow: "4px 4px 10px rgba(44,44,42,0.16)" }}
        >
          {driverPhotoUrl ? (
            <img src={driverPhotoUrl} alt={businessName} className="h-full w-full object-cover" />
          ) : (
            <Car size={30} color="var(--accent)" />
          )}
        </div>
        <div className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>
          {businessName || "Driver"}
        </div>
        {licenceVerified && (
          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: "var(--success-text)" }}>
            <ShieldCheck size={12} /> Verified SPSV licence
          </div>
        )}
        {avgRating != null && (
          <div className="mt-2 flex items-center gap-2">
            <StarRow rating={Math.round(avgRating)} size={16} />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{avgRating.toFixed(1)}</span>
            <span className="text-xs text-[var(--text-muted)]">({reviewCount})</span>
          </div>
        )}
      </div>

      {vehicle && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
            style={{ background: "var(--bg-card-alt)" }}
          >
            {vehiclePhotoUrl ? (
              <img src={vehiclePhotoUrl} alt="Vehicle" className="h-full w-full object-cover" />
            ) : (
              <Car size={22} color="var(--text-muted)" />
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {vehicle.make} {vehicle.model} · {vehicle.color}
            </div>
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Users size={11} /> {vehicle.seats} passenger seats
            </div>
          </div>
        </div>
      )}

      <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Reviews</div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-secondary)]">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : errorMessage ? (
        <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
          <AlertCircle size={13} /> {errorMessage}
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl p-8 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <MessageSquareQuote size={20} color="var(--text-muted)" />
          <div className="text-xs text-[var(--text-muted)]">No reviews yet.</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-2xl p-3.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
              <div className="mb-1 flex items-center justify-between">
                <StarRow rating={r.rating} />
                <span className="text-[11px] text-[var(--text-muted)]">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              {r.comment && <p className="text-xs text-[var(--text-primary)]">{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
