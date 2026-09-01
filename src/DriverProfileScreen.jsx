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
        <Star key={n} size={size} fill={n <= rating ? "#F5B300" : "none"} color={n <= rating ? "#F5B300" : "#D3D1C7"} strokeWidth={1.5} />
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
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ fontFamily: "Inter" }}>
      <button
        onClick={onBack}
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
      >
        <ArrowLeft size={15} color="#5F5E5A" />
      </button>

      <div className="mb-5 flex flex-col items-center text-center">
        <div
          className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full"
          style={{ background: "linear-gradient(155deg, #FFFFFF, #E7E5DD)", boxShadow: "4px 4px 10px rgba(44,44,42,0.16)" }}
        >
          {driverPhotoUrl ? (
            <img src={driverPhotoUrl} alt={businessName} className="h-full w-full object-cover" />
          ) : (
            <Car size={30} color="#185FA5" />
          )}
        </div>
        <div className="text-lg font-bold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
          {businessName || "Driver"}
        </div>
        {licenceVerified && (
          <div className="mt-1 flex items-center gap-1 text-xs" style={{ color: "#27500A" }}>
            <ShieldCheck size={12} /> Verified SPSV licence
          </div>
        )}
        {avgRating != null && (
          <div className="mt-2 flex items-center gap-2">
            <StarRow rating={Math.round(avgRating)} size={16} />
            <span className="text-sm font-semibold text-[#2C2C2A]">{avgRating.toFixed(1)}</span>
            <span className="text-xs text-[#8C8977]">({reviewCount})</span>
          </div>
        )}
      </div>

      {vehicle && (
        <div className="mb-5 flex items-center gap-3 rounded-xl p-4" style={{ background: "#FBFAF6", border: "1px solid #ECE9E0" }}>
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl"
            style={{ background: "#F1EFE8" }}
          >
            {vehiclePhotoUrl ? (
              <img src={vehiclePhotoUrl} alt="Vehicle" className="h-full w-full object-cover" />
            ) : (
              <Car size={22} color="#8C8977" />
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-[#2C2C2A]">
              {vehicle.make} {vehicle.model} · {vehicle.color}
            </div>
            <div className="flex items-center gap-1 text-xs text-[#8C8977]">
              <Users size={11} /> {vehicle.seats} passenger seats
            </div>
          </div>
        </div>
      )}

      <div className="mb-3 text-sm font-semibold text-[#2C2C2A]">Reviews</div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#5F5E5A]">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : errorMessage ? (
        <div className="flex items-center gap-2 rounded-lg p-3 text-xs" style={{ background: "#FCEBEB", color: "#791F1F" }}>
          <AlertCircle size={13} /> {errorMessage}
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl p-8 text-center" style={{ background: "#FBFAF6", border: "1px solid #ECE9E0" }}>
          <MessageSquareQuote size={20} color="#B4B2A9" />
          <div className="text-xs text-[#8C8977]">No reviews yet.</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl p-3.5" style={{ background: "#FBFAF6", border: "1px solid #ECE9E0" }}>
              <div className="mb-1 flex items-center justify-between">
                <StarRow rating={r.rating} />
                <span className="text-[11px] text-[#8C8977]">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              {r.comment && <p className="text-xs text-[#2C2C2A]">{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
