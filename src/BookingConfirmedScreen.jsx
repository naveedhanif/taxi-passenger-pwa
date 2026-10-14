import { useEffect } from "react";
import { isIosStandalone } from "./iosStandalone.js";
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
      className="mx-auto flex w-full max-w-[430px] flex-col items-center p-5 text-center"
      style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter", minHeight: 640 }}
    >
      <div className="mt-10 mb-5">
        <CheckCircle2 size={40} color="var(--success-text)" />
      </div>

      <div className="mb-1 text-xl" style={{ fontFamily: "'Space Grotesk'", fontWeight: 700, color: "var(--text-primary)" }}>
        Booking confirmed
      </div>
      <div className="mb-6 text-sm text-[var(--text-secondary)]">
        You'll get updates here as your driver gets closer.
      </div>

      <div
        className="mb-6 w-full rounded-2xl p-4 text-left"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
      >
        <div className="space-y-2.5 text-sm">
          <div className="flex items-start gap-2">
            <MapPin size={14} color="var(--text-muted)" className="mt-0.5" />
            <div>
              <div className="text-[var(--text-primary)]">{pickup.address}</div>
              <div className="text-[11px] text-[var(--text-muted)]">Pickup</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={14} color="var(--accent)" className="mt-0.5" />
            <div>
              <div className="text-[var(--text-primary)]">{dropoff.address}</div>
              <div className="text-[11px] text-[var(--text-muted)]">Drop-off</div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 border-t border-[var(--border-card)] pt-3 text-xs text-[var(--text-secondary)]">
          <div className="flex items-center gap-1.5"><Calendar size={12} /> {dateLabel}</div>
          <div className="flex items-center gap-1.5"><Clock size={12} /> {timeLabel}</div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[var(--border-card)] pt-3">
          <span className="text-xs text-[var(--text-secondary)]">{balanceDue != null ? "Deposit paid" : "Total paid"}</span>
          <span className="text-base font-semibold text-[var(--text-primary)]">€{totalPaid.toFixed(2)}</span>
        </div>
        {balanceDue != null && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">Balance due (cash or card, after the ride)</span>
            <span className="text-sm font-medium text-[var(--warning-text)]">€{balanceDue.toFixed(2)}</span>
          </div>
        )}
      </div>

      {phoneLinks && (
        <div
          className="mb-6 w-full rounded-2xl p-4"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
        >
          <div className="mb-2 text-left text-xs font-medium text-[var(--text-secondary)]">
            Need to reach {driverName || "your driver"}?
          </div>
          <div className="flex gap-2">
            <a
              href={`tel:${phoneLinks.tel}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-[var(--text-primary)]"
              style={{ background: "var(--bg-card-alt)", boxShadow: "2px 2px 5px rgba(44,44,42,0.1), -2px -2px 5px rgba(255,255,255,0.7)" }}
            >
              <Phone size={13} /> Call
            </a>
            <a
              href={`https://wa.me/${phoneLinks.whatsapp}`}
              {...(isIosStandalone() ? {} : { target: "_blank", rel: "noreferrer" })}
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
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white"
        style={{
          background: "var(--accent-gradient)",
          boxShadow: "var(--shadow-accent-btn)",
        }}
      >
        View my booking <ArrowRight size={15} />
      </button>
    </div>
  );
}

