import { useEffect, useMemo, useState } from "react";
import { User, MapPin, Clock, Home, Briefcase, Trash2, LogOut, ChevronRight, ArrowLeft, Pencil, Check, X, Phone, AlertCircle, RotateCw, Bell, BellOff, Loader2 } from "lucide-react";
import { enablePushNotifications, getPushPermissionState, isPushSupported } from "./pushNotifications.js";

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

function BookingRow({ booking, onSelect, onBookAgain, isPast }) {
  const s = STATUS_LABEL[booking.status] || STATUS_LABEL.pending;
  const dateLabel = new Date(booking.scheduled_time).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
  return (
    <div className="rounded-lg border border-[#ECE9E0] px-3.5 py-3">
      <button onClick={() => onSelect(booking)} className="flex w-full items-center justify-between text-left">
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
      {isPast && onBookAgain && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBookAgain(booking);
          }}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
        >
          <RotateCw size={12} /> Book again
        </button>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {{name:string,phone:string,email:string}|null} props.customer
 * @param {Array} props.bookings
 * @param {Array} [props.savedLocations] - [{id, label, address}]
 * @param {function} props.onSelectBooking
 * @param {function} [props.onBookAgain] - pre-fills a fresh booking with a past trip's details
 * @param {function} [props.onDeleteLocation]
 * @param {function} props.onSignOut
 * @param {function} [props.onUpdateProfile] - (name, phone) => Promise<{error?: string}>; the real, direct way to fix a wrong name/phone, instead of relying on it getting picked up from a future booking form
 * @param {string} [props.driverId] - needed to register a push subscription against the right (driver, customer) pair
 * @param {string|null} [props.customerSessionToken]
 */
export default function AccountHistoryScreen({
  customer = null,
  bookings = [],
  savedLocations = [],
  onSelectBooking = () => {},
  onBookAgain,
  onDeleteLocation = () => {},
  recurringRides = [],
  onToggleRecurringRide = () => {},
  onDeleteRecurringRide = () => {},
  onSignOut = () => {},
  onBack = () => {},
  onUpdateProfile = null,
  driverId = null,
  customerSessionToken = null,
}) {
  useGoogleFont();
  const [tab, setTab] = useState("upcoming");
  const [editingProfile, setEditingProfile] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [pushPermission, setPushPermission] = useState(() => getPushPermissionState());
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushError, setPushError] = useState("");

  async function handleEnablePush() {
    setEnablingPush(true);
    setPushError("");
    const result = await enablePushNotifications({ driverId, customerSessionToken });
    setEnablingPush(false);
    if (result.error) {
      setPushError(result.error);
      setPushPermission(getPushPermissionState());
      return;
    }
    setPushPermission("granted");
  }

  const { upcoming, past } = useMemo(() => categorizeBookings(bookings), [bookings]);
  const visibleBookings = tab === "upcoming" ? upcoming : past;

  // A name that's really just the email's local part (left behind by an
  // account that got auto-repaired from email alone at some point) isn't
  // a real name — flag it so the header can prompt for the real one
  // instead of quietly displaying it as if it were correct.
  const nameLooksLikePlaceholder =
    customer?.email && customer?.name && customer.email.toLowerCase().startsWith(customer.name.toLowerCase());

  function startEditingProfile() {
    setEditName(nameLooksLikePlaceholder ? "" : customer?.name || "");
    setEditPhone(customer?.phone || "");
    setProfileError("");
    setEditingProfile(true);
  }

  async function saveProfile() {
    if (!onUpdateProfile) return;
    setSavingProfile(true);
    setProfileError("");
    const result = await onUpdateProfile(editName.trim(), editPhone.trim());
    setSavingProfile(false);
    if (result?.error) {
      setProfileError(result.error);
      return;
    }
    setEditingProfile(false);
  }

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
      <div className="mb-5 flex items-start gap-3">
        <button
          onClick={onBack}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
          style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
          aria-label="Back"
        >
          <ArrowLeft size={15} color="#5F5E5A" />
        </button>

        {editingProfile ? (
          <div className="flex-1 rounded-xl p-3" style={{ background: "#FBFAF6", border: "1px solid #ECE9E0" }}>
            <div className="mb-2 space-y-2">
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "#F0EEE7", boxShadow: "inset 2px 2px 5px rgba(44,44,42,0.14), inset -2px -2px 5px rgba(255,255,255,0.8)" }}
              >
                <User size={14} color="#8C8977" />
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[#8C8977]"
                  style={{ color: "#2C2C2A" }}
                />
              </div>
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "#F0EEE7", boxShadow: "inset 2px 2px 5px rgba(44,44,42,0.14), inset -2px -2px 5px rgba(255,255,255,0.8)" }}
              >
                <Phone size={14} color="#8C8977" />
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Phone number"
                  type="tel"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[#8C8977]"
                  style={{ color: "#2C2C2A" }}
                />
              </div>
            </div>
            {profileError && (
              <div className="mb-2 flex items-center gap-1.5 rounded-lg p-2 text-[11px]" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                <AlertCircle size={12} /> {profileError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={saveProfile}
                disabled={savingProfile || !editName.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
              >
                <Check size={13} /> {savingProfile ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setEditingProfile(false)}
                disabled={savingProfile}
                className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[#5F5E5A]"
                style={{ background: "#F0EEE7" }}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #378ADD, #0C447C)" }}
            >
              {!nameLooksLikePlaceholder && customer.name?.charAt(0)?.toUpperCase() || <User size={18} />}
            </div>
            <div className="flex-1">
              {nameLooksLikePlaceholder ? (
                <div className="text-sm font-medium" style={{ color: "#633806" }}>Add your name</div>
              ) : (
                <div className="text-base font-semibold text-[#2C2C2A]" style={{ fontFamily: "'Space Grotesk'" }}>
                  {customer.name || "Your account"}
                </div>
              )}
              <div className="text-xs text-[#5F5E5A]">{customer.phone || "Add a phone number"}</div>
            </div>
            {onUpdateProfile && (
              <button
                onClick={startEditingProfile}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: "#F0EEE7", boxShadow: "3px 3px 6px rgba(44,44,42,0.14), -3px -3px 6px rgba(255,255,255,0.85)" }}
                aria-label="Edit profile"
              >
                <Pencil size={13} color="#5F5E5A" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Push notifications */}
      {isPushSupported() && (
        <div className="mb-5">
          <div
            className="flex items-center justify-between rounded-xl p-3.5"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            <div className="flex items-center gap-2.5">
              {pushPermission === "granted" ? <Bell size={16} color="#185FA5" /> : <BellOff size={16} color="#8C8977" />}
              <div>
                <div className="text-xs font-semibold text-[#2C2C2A]">Notifications</div>
                <div className="text-[11px] text-[#8C8977]">
                  {pushPermission === "granted"
                    ? "You'll be notified even if the app is closed."
                    : pushPermission === "denied"
                    ? "Blocked in your browser settings."
                    : "Get notified of trip updates and messages."}
                </div>
              </div>
            </div>
            {pushPermission !== "granted" && pushPermission !== "denied" && (
              <button
                onClick={handleEnablePush}
                disabled={enablingPush}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                style={{ background: "#185FA5" }}
              >
                {enablingPush ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                Enable
              </button>
            )}
          </div>
          {pushError && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg p-2 text-[11px]" style={{ background: "#FCEBEB", color: "#791F1F" }}>
              <AlertCircle size={12} /> {pushError}
            </div>
          )}
        </div>
      )}

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

      {/* Recurring ride templates */}
      {recurringRides.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-medium text-[#5F5E5A]">Recurring rides</div>
          <div
            className="rounded-xl p-2"
            style={{ background: "#FBFAF6", border: "1px solid #ECE9E0", boxShadow: "6px 6px 14px rgba(44,44,42,0.10), -6px -6px 14px rgba(255,255,255,0.85)" }}
          >
            {recurringRides.map((ride) => (
              <div key={ride.id} className="flex items-center justify-between px-2 py-2.5">
                <div className="flex items-center gap-2.5">
                  <RotateCw size={14} color={ride.active ? "#185FA5" : "#B4B2A9"} />
                  <div>
                    <div className="text-xs font-medium text-[#2C2C2A]">{ride.label}</div>
                    <div className="text-[11px] text-[#8C8977]">
                      {(ride.days_of_week || []).map((d) => d.slice(0, 3)).join(", ")} · {ride.time_of_day}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleRecurringRide(ride.id, !ride.active)}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: ride.active ? "#EAF3DE" : "#F1EFE8", color: ride.active ? "#27500A" : "#8C8977" }}
                  >
                    {ride.active ? "On" : "Off"}
                  </button>
                  <button onClick={() => onDeleteRecurringRide(ride.id)}>
                    <Trash2 size={13} color="#B4B2A9" />
                  </button>
                </div>
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
          visibleBookings.map((b) => (
            <BookingRow key={b.id} booking={b} onSelect={onSelectBooking} onBookAgain={onBookAgain} isPast={tab === "past"} />
          ))
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

