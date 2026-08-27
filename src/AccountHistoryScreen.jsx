import { useEffect, useMemo, useState } from "react";
import { User, MapPin, Clock, Home, Briefcase, Trash2, LogOut, ChevronRight, ArrowLeft } from "lucide-react";

// Inlined from bookingHistory.js (tested separately — see that file for
// the test suite). Artifact preview can't import local files, so this
// copy must be kept in sync by hand if the logic ever changes.
const ACTIVE_STATUSES = ["pending", "confirmed", "en_route", "arrived", "in_progress"];
const PAST_STATUSES = ["completed", "canceled"];

function categorizeBookings(bookings) {
  const upcoming = bookings
    .filter((b) => ACTIVE_STATUSES.includes(b.status))
    .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
  const past = bookings
    .filter((b) => PAST_STATUSES.includes(b.status))
    .sort((a, b) => new Date(b.scheduled_time) - new Date(a.scheduled_time));
  return { upcoming, past };
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

const STATUS_LABEL = {
  pending: { label: "Pending", bg: "#FAEEDA", text: "#633806" },
  confirmed: { label: "Confirmed", bg: "#EAF3DE", text: "#27500A" },
  en_route: { label: "En route", bg: "#E6F1FB", text: "#0C447C" },
  arrived: { label: "Arrived", bg: "#E6F1FB", text: "#0C447C" },
  in_progress: { label: "In progress", bg: "#E6F1FB", text: "#0C447C" },
  completed: { label: "Completed", bg: "#F1EFE8", text: "#5F5E5A" },
  canceled: { label: "Canceled", bg: "#FCEBEB", text: "#791F1F" },
};

function BookingRow({ booking, onSelect }) {
  const s = STATUS_LABEL[booking.status] || STATUS_LABEL.pending;
  const dateLabel = new Date(booking.scheduled_time).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
  return (
    <button
      onClick={() => onSelect(booking)}
      className="flex w-full items-center justify-between rounded-lg border border-[#ECE9E0] px-3.5 py-3 text-left"
    >
      <div>
        <div className="text-sm text-[#2C2C2A]">{booking.pickup_address} → {booking.dropoff_address}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#8C8977]">
          <Clock size={10} /> {dateLabel}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: s.bg, color: s.text }}>
          {s.label}
        </span>
        <ChevronRight size={14} color="#B4B2A9" />
      </div>
    </button>
  );
}

/**
 * @param {object} props
 * @param {{name:string,phone:string,email:string}|null} props.customer
 * @param {Array} props.bookings
 * @param {Array} [props.savedLocations] - [{id, label, address}]
 * @param {function} props.onSelectBooking
 * @param {function} [props.onDeleteLocation]
 * @param {function} props.onSignOut
 */
export default function AccountHistoryScreen({
  customer = null,
  bookings = [],
  savedLocations = [],
  onSelectBooking = () => {},
  onDeleteLocation = () => {},
  onSignOut = () => {},
  onBack = () => {},
}) {
  useGoogleFont();
  const [tab, setTab] = useState("upcoming");

  const { upcoming, past } = useMemo(() => categorizeBookings(bookings), [bookings]);
  const visibleBookings = tab === "upcoming" ? upcoming : past;

  if (!customer) {
    return (
      <div className="mx-auto w-full max-w-[400px] p-5" style={{ minHeight: 400 }}>
        <button
          onClick={onBack}
          className="mb-4 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
          aria-label="Back"
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
          <User size={22} color="#8C8977" />
          <div className="text-sm text-[#5F5E5A]">Sign in to see your account and booking history.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "#F7F7F5", fontFamily: "Inter", minHeight: 640 }}>
      {/* Account header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
          aria-label="Back"
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
        >
          {customer.name?.charAt(0) || <User size={18} />}
        </div>
        <div>
          <div className="text-base font-semibold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
            {customer.name || "Your account"}
          </div>
          <div className="text-xs text-[#5F5E5A]">{customer.phone || customer.email}</div>
        </div>
      </div>

      {/* Saved locations */}
      {savedLocations.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-medium text-[#5F5E5A]">Saved locations</div>
          <div
            className="rounded-xl p-2"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            {savedLocations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between px-2 py-2">
                <div className="flex items-center gap-2.5">
                  {loc.label.toLowerCase() === "home" ? <Home size={14} color="#8C8977" /> : loc.label.toLowerCase() === "work" ? <Briefcase size={14} color="#8C8977" /> : <MapPin size={14} color="#8C8977" />}
                  <div>
                    <div className="text-xs font-medium text-[#2C2C2A]">{loc.label}</div>
                    <div className="text-[11px] text-[#8C8977]">{loc.address}</div>
                  </div>
                </div>
                <button onClick={() => onDeleteLocation(loc.id)}>
                  <Trash2 size={13} color="#B4B2A9" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Booking history */}
      <div className="mb-2 flex gap-1.5 rounded-full p-1" style={{ background: "#EFEDE5" }}>
        <button
          onClick={() => setTab("upcoming")}
          className="flex-1 rounded-full py-1.5 text-xs font-medium"
          style={{ background: tab === "upcoming" ? "#185FA5" : "transparent", color: tab === "upcoming" ? "#FFFFFF" : "#8C8977" }}
        >
          Upcoming ({upcoming.length})
        </button>
        <button
          onClick={() => setTab("past")}
          className="flex-1 rounded-full py-1.5 text-xs font-medium"
          style={{ background: tab === "past" ? "#185FA5" : "transparent", color: tab === "past" ? "#FFFFFF" : "#8C8977" }}
        >
          Past ({past.length})
        </button>
      </div>

      <div className="mb-6 space-y-2">
        {visibleBookings.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8C8977]">
            {tab === "upcoming" ? "No upcoming trips" : "No past trips yet"}
          </div>
        ) : (
          visibleBookings.map((b) => <BookingRow key={b.id} booking={b} onSelect={onSelectBooking} />)
        )}
      </div>

      <button
        onClick={onSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-medium text-[#791F1F]"
        style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
      >
        <LogOut size={13} /> Sign out
      </button>
    </div>
  );
}

