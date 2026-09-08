import { useEffect, useMemo, useState } from "react";
import { User, MapPin, Clock, Home, Briefcase, Trash2, LogOut, ChevronRight, ArrowLeft, Pencil, Check, X, Phone, AlertCircle, RotateCw, Bell, BellOff, Loader2, Car, Tag } from "lucide-react";
import { enablePushNotifications, getPushPermissionState, isPushSupported, isIosNonStandalone } from "./pushNotifications.js";

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
  pending: { label: "Pending", bg: "var(--warning-bg)", text: "var(--warning-text)" },
  confirmed: { label: "Confirmed", bg: "var(--success-bg)", text: "var(--success-text)" },
  en_route: { label: "En route", bg: "var(--info-bg)", text: "var(--info-text)" },
  arrived: { label: "Arrived", bg: "var(--info-bg)", text: "var(--info-text)" },
  in_progress: { label: "In progress", bg: "var(--info-bg)", text: "var(--info-text)" },
  completed: { label: "Completed", bg: "var(--bg-card-alt)", text: "var(--text-secondary)" },
  canceled: { label: "Canceled", bg: "var(--error-bg)", text: "var(--error-text)" },
};

function BookingRow({ booking, onSelect, onBookAgain, isPast }) {
  const s = STATUS_LABEL[booking.status] || STATUS_LABEL.pending;
  const dateLabel = new Date(booking.scheduled_time).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
  return (
    <div className="rounded-lg border border-[var(--border-card)] px-3.5 py-3">
      <button onClick={() => onSelect(booking)} className="flex w-full items-center justify-between text-left">
        <div>
          <div className="text-sm text-[var(--text-primary)]">{booking.pickup_address} → {booking.dropoff_address}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Clock size={10} /> {dateLabel}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: s.bg, color: s.text }}>
            {s.label}
          </span>
          <ChevronRight size={14} color="var(--text-muted)" />
        </div>
      </button>
      {isPast && onBookAgain && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onBookAgain(booking);
          }}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white"
          style={{ background: "var(--accent-gradient)" }}
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
  onNavigate = () => {},
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

  // Real count from the same bookings array already passed into this
  // screen — no separate query needed for the profile header's stat line.
  const completedTripCount = bookings.filter((b) => b.status === "completed").length;

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
          style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
          aria-label="Back"
        >
          <ArrowLeft size={15} color="var(--text-secondary)" />
        </button>
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <User size={22} color="var(--text-muted)" />
          <div className="text-sm text-[var(--text-secondary)]">Sign in to see your account and booking history.</div>
          <button
            onClick={() => onNavigate("auth")}
            className="mt-1 rounded-full px-5 py-2.5 text-xs font-semibold text-white"
            style={{ background: "var(--accent-gradient)" }}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[400px] p-5" style={{ backgroundColor: "var(--bg-page)", fontFamily: "Inter", minHeight: 640 }}>
      {/* Profile header — centered avatar/name/stat, matching the
          reference layout, kept in this project's light/embossed
          theme rather than the reference's dark colors. Trip count is
          real, derived from the same bookings array already passed
          into this screen (not a separate query). */}
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
          aria-label="Back"
        >
          <ArrowLeft size={15} color="var(--text-secondary)" />
        </button>
        <div className="flex items-center gap-2">
          {onUpdateProfile && !editingProfile && (
            <button
              onClick={startEditingProfile}
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
              aria-label="Edit profile"
            >
              <Pencil size={13} color="var(--text-secondary)" />
            </button>
          )}
        </div>
      </div>

      {editingProfile ? (
        <div className="mb-5 rounded-xl p-3.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <div className="mb-2 space-y-2">
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-inset)" }}
            >
              <User size={14} color="var(--text-muted)" />
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Your name"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-inset)" }}
            >
              <Phone size={14} color="var(--text-muted)" />
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="Phone number"
                type="tel"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
          </div>
          {profileError && (
            <div className="mb-2 flex items-center gap-1.5 rounded-lg p-2 text-[11px]" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
              <AlertCircle size={12} /> {profileError}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={saveProfile}
              disabled={savingProfile || !editName.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--accent-gradient)" }}
            >
              <Check size={13} /> {savingProfile ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setEditingProfile(false)}
              disabled={savingProfile}
              className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
              style={{ background: "var(--bg-card-alt)" }}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-3 flex h-20 w-20 items-center justify-center rounded-full text-xl font-bold text-white"
            style={{ background: "var(--accent-gradient)", fontFamily: "'Space Grotesk'", boxShadow: "var(--shadow-raised)" }}
          >
            {!nameLooksLikePlaceholder && customer.name?.charAt(0)?.toUpperCase() || <User size={26} />}
          </div>
          {nameLooksLikePlaceholder ? (
            <div className="text-base font-semibold" style={{ color: "var(--warning-text)" }}>Add your name</div>
          ) : (
            <div className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "'Space Grotesk'" }}>{customer.name || "Your account"}</div>
          )}
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            {customer.phone || "Add a phone number"}
            {completedTripCount > 0 && <> · {completedTripCount} {completedTripCount === 1 ? "trip" : "trips"}</>}
          </div>
        </div>
      )}

      {/* Quick action tiles */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <button onClick={() => onNavigate("booking")} className="flex flex-col items-center gap-1.5 rounded-xl py-4 text-xs font-semibold text-[var(--text-primary)]" style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}>
          <Car size={18} className="text-[var(--accent)]" /> Book
        </button>
        <button onClick={() => onNavigate("status")} className="flex flex-col items-center gap-1.5 rounded-xl py-4 text-xs font-semibold text-[var(--text-primary)]" style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}>
          <MapPin size={18} className="text-[var(--accent)]" /> Track
        </button>
        <button onClick={() => onNavigate("promos")} className="flex flex-col items-center gap-1.5 rounded-xl py-4 text-xs font-semibold text-[var(--text-primary)]" style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}>
          <Tag size={18} className="text-[var(--accent)]" /> Promos
        </button>
      </div>

      {/* Push notifications */}
      {isIosNonStandalone() && (
        <div className="mb-5 rounded-xl p-3.5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <div className="mb-1.5 flex items-center gap-2.5">
            <Bell size={16} color="var(--accent)" />
            <div className="text-xs font-semibold text-[var(--text-primary)]">Get notifications on iPhone</div>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            iPhone only allows notifications for apps added to your Home Screen — not a regular Safari tab. Tap{" "}
            <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open from that new icon to enable them.
          </p>
        </div>
      )}
      {!isIosNonStandalone() && isPushSupported() && (
        <div className="mb-5">
          <div
            className="flex items-center justify-between rounded-xl p-3.5"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            <div className="flex items-center gap-2.5">
              {pushPermission === "granted" ? <Bell size={16} color="var(--accent)" /> : <BellOff size={16} color="var(--text-muted)" />}
              <div>
                <div className="text-xs font-semibold text-[var(--text-primary)]">Notifications</div>
                <div className="text-[11px] text-[var(--text-muted)]">
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
                style={{ background: "var(--accent)" }}
              >
                {enablingPush ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                Enable
              </button>
            )}
          </div>
          {pushError && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg p-2 text-[11px]" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
              <AlertCircle size={12} /> {pushError}
            </div>
          )}
        </div>
      )}

      {/* Saved locations */}
      {savedLocations.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Saved locations</div>
          <div
            className="rounded-xl p-2"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            {savedLocations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between px-2 py-2">
                <div className="flex items-center gap-2.5">
                  {loc.label.toLowerCase() === "home" ? <Home size={14} color="var(--text-muted)" /> : loc.label.toLowerCase() === "work" ? <Briefcase size={14} color="var(--text-muted)" /> : <MapPin size={14} color="var(--text-muted)" />}
                  <div>
                    <div className="text-xs font-medium text-[var(--text-primary)]">{loc.label}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">{loc.address}</div>
                  </div>
                </div>
                <button onClick={() => onDeleteLocation(loc.id)}>
                  <Trash2 size={13} color="var(--text-muted)" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recurring ride templates */}
      {recurringRides.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Recurring rides</div>
          <div
            className="rounded-xl p-2"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-raised)" }}
          >
            {recurringRides.map((ride) => (
              <div key={ride.id} className="flex items-center justify-between px-2 py-2.5">
                <div className="flex items-center gap-2.5">
                  <RotateCw size={14} color={ride.active ? "var(--accent)" : "var(--text-muted)"} />
                  <div>
                    <div className="text-xs font-medium text-[var(--text-primary)]">{ride.label}</div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {(ride.days_of_week || []).map((d) => d.slice(0, 3)).join(", ")} · {ride.time_of_day}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleRecurringRide(ride.id, !ride.active)}
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: ride.active ? "var(--success-bg)" : "var(--bg-card-alt)", color: ride.active ? "var(--success-text)" : "var(--text-muted)" }}
                  >
                    {ride.active ? "On" : "Off"}
                  </button>
                  <button onClick={() => onDeleteRecurringRide(ride.id)}>
                    <Trash2 size={13} color="var(--text-muted)" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Booking history */}
      <div className="mb-2 flex gap-1.5 rounded-full p-1" style={{ background: "var(--bg-card-alt)" }}>
        <button
          onClick={() => setTab("upcoming")}
          className="flex-1 rounded-full py-1.5 text-xs font-medium"
          style={{ background: tab === "upcoming" ? "var(--accent)" : "transparent", color: tab === "upcoming" ? "white" : "var(--text-muted)" }}
        >
          Upcoming ({upcoming.length})
        </button>
        <button
          onClick={() => setTab("past")}
          className="flex-1 rounded-full py-1.5 text-xs font-medium"
          style={{ background: tab === "past" ? "var(--accent)" : "transparent", color: tab === "past" ? "white" : "var(--text-muted)" }}
        >
          Past ({past.length})
        </button>
      </div>

      <div className="mb-6 space-y-2">
        {visibleBookings.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--text-muted)]">
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
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs font-medium text-[var(--error-text)]"
        style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}
      >
        <LogOut size={13} /> Sign out
      </button>
    </div>
  );
}

