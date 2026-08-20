import { useEffect } from "react";
import { CheckCircle2, MapPin, Calendar, Clock, ArrowRight } from "lucide-react";

function useGoogleFont() {
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

/**
 * @param {object} props
 * @param {{address:string}} props.pickup
 * @param {{address:string}} props.dropoff
 * @param {Date} props.scheduledTime
 * @param {number} props.totalPaid
 * @param {function} props.onViewBooking - go to the live tracking screen
 */
export default function BookingConfirmedScreen({ pickup, dropoff, scheduledTime, totalPaid, onViewBooking }) {
  useGoogleFont();

  const dateLabel = scheduledTime.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const timeLabel = scheduledTime.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="mx-auto flex w-full max-w-[400px] flex-col items-center p-5 text-center"
      style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}
    >
      <div className="mt-10 mb-5">
        <CheckCircle2 size={40} color="#639922" />
      </div>

      <div className="mb-1 text-xl" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: "#2C2C2A" }}>
        Booking confirmed
      </div>
      <div className="mb-6 text-sm text-[#5F5E5A]">
        You'll get updates here as your driver gets closer.
      </div>

      <div
        className="mb-6 w-full rounded-xl p-4 text-left"
        style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
      >
        <div className="space-y-2.5 text-sm">
          <div className="flex items-start gap-2">
            <MapPin size={14} color="#8C8977" className="mt-0.5" />
            <div>
              <div className="text-[#2C2C2A]">{pickup.address}</div>
              <div className="text-[11px] text-[#8C8977]">Pickup</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={14} color="#185FA5" className="mt-0.5" />
            <div>
              <div className="text-[#2C2C2A]">{dropoff.address}</div>
              <div className="text-[11px] text-[#8C8977]">Drop-off</div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 border-t border-[#ECE9E0] pt-3 text-xs text-[#5F5E5A]">
          <div className="flex items-center gap-1.5"><Calendar size={12} /> {dateLabel}</div>
          <div className="flex items-center gap-1.5"><Clock size={12} /> {timeLabel}</div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#ECE9E0] pt-3">
          <span className="text-xs text-[#5F5E5A]">Total paid</span>
          <span className="text-base font-semibold text-[#2C2C2A]">€{totalPaid.toFixed(2)}</span>
        </div>
      </div>

      <button
        onClick={onViewBooking}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white"
        style={{
          background: "linear-gradient(135deg, #378ADD, #0C447C)",
          boxShadow: "3px 3px 8px rgba(4,44,83,0.35), -2px -2px 6px rgba(133,183,235,0.5)",
        }}
      >
        View my booking <ArrowRight size={15} />
      </button>
    </div>
  );
}

