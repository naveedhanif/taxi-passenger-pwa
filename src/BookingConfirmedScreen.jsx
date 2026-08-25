import { useEffect } from "react";
import { CheckCircle2, MapPin, Calendar, Clock, ArrowRight, Phone, MessageCircle } from "lucide-react";
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

/**
 * @param {object} props
 * @param {{address:string}} props.pickup
 * @param {{address:string}} props.dropoff
 * @param {Date} props.scheduledTime
 * @param {number} props.totalPaid
 * @param {number|null} [props.balanceDue] - remaining amount owed to the driver directly (pay-later bookings only)
 * @param {string} [props.driverName]
 * @param {string|null} [props.driverPhoneNumber]
 * @param {function} props.onViewBooking - go to the live tracking screen
 */
export default function BookingConfirmedScreen({ pickup, dropoff, scheduledTime, totalPaid, balanceDue, driverName, driverPhoneNumber, onViewBooking }) {
  useGoogleFont();
  const phoneLinks = formatPhoneForLinks(driverPhoneNumber);

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
          <span className="text-xs text-[#5F5E5A]">{balanceDue != null ? "Deposit paid" : "Total paid"}</span>
          <span className="text-base font-semibold text-[#2C2C2A]">€{totalPaid.toFixed(2)}</span>
        </div>
        {balanceDue != null && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-[#5F5E5A]">Balance due (cash or card, after the ride)</span>
            <span className="text-sm font-medium text-[#633806]">€{balanceDue.toFixed(2)}</span>
          </div>
        )}
      </div>

      {phoneLinks && (
        <div
          className="mb-6 w-full rounded-xl p-4"
          style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
        >
          <div className="mb-2 text-left text-xs font-medium text-[#5F5E5A]">
            Need to reach {driverName || "your driver"}?
          </div>
          <div className="flex gap-2">
            <a
              href={`tel:${phoneLinks.tel}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-[#2C2C2A]"
              style={{ background: "#F0EEE7", boxShadow: "2px 2px 5px rgba(44,44,42,0.1), -2px -2px 5px rgba(255,255,255,0.7)" }}
            >
              <Phone size={13} /> Call
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
        </div>
      )}

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

