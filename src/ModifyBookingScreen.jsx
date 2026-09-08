import { useState, useEffect } from "react";
import { ArrowLeft, MapPin, Calendar, Clock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { searchAddress, retrieveSuggestion, createSearchSessionToken, suggestionLabel } from "./mapboxClient.js";
import { modifyBooking } from "./bookingStatusApi.js";

// New — pickup/drop-off/time modification for a booking that hasn't
// progressed past "confirmed" yet. Reuses the exact same address-search
// functions (searchAddress/retrieveSuggestion/suggestionLabel) already
// proven working on the main booking form, not a separate
// reimplementation. Stops aren't editable here yet — a deliberate,
// disclosed scope boundary for this first version, not an oversight.

function useDebouncedAddressSearch(query, mapboxToken, session) {
  const [suggestions, setSuggestions] = useState([]);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    if (!mapboxToken || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const result = await searchAddress(query, mapboxToken, session);
        setSuggestions(result.suggestions);
        setSearchError("");
      } catch (err) {
        console.error("Modify booking address search failed:", err);
        setSuggestions([]);
        setSearchError("Address search isn't working right now — try again in a moment.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, mapboxToken, session]);

  return { suggestions, searchError, setSuggestions };
}

function AddressField({ label, value, onChange, onSelect, mapboxToken, session }) {
  const { suggestions, searchError, setSuggestions } = useDebouncedAddressSearch(value, mapboxToken, session);

  return (
    <div className="relative mb-4">
      <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</label>
      <div className="flex items-center gap-2 rounded-xl p-3" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
        <MapPin size={15} className="shrink-0" color="var(--text-muted)" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search an address"
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>
      {suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-dropdown)" }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={async () => {
                const label = suggestionLabel(s);
                setSuggestions([]);
                try {
                  const coords = await retrieveSuggestion(s.mapboxId, mapboxToken, session);
                  onSelect({ address: label, lat: coords?.lat, lng: coords?.lng });
                } catch {
                  onSelect({ address: label, lat: null, lng: null });
                }
              }}
              className="block w-full px-4 py-2.5 text-left hover:bg-black/5"
            >
              {s.name && s.fullAddress && !s.fullAddress.toLowerCase().includes(s.name.toLowerCase()) ? (
                <>
                  <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{s.name}</div>
                  <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.fullAddress}</div>
                </>
              ) : (
                <div className="text-xs" style={{ color: "var(--text-primary)" }}>{s.fullAddress || s.name}</div>
              )}
            </button>
          ))}
        </div>
      )}
      {searchError && <div className="mt-1 text-[11px]" style={{ color: "var(--error-text)" }}>{searchError}</div>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.booking - the currently-loaded booking (pickup/dropoff/scheduledTime shape from get-booking-status)
 * @param {string} props.bookingId
 * @param {string|null} props.guestAccessToken
 * @param {string|null} props.customerSessionToken
 * @param {string} props.mapboxToken
 * @param {function} props.onClose
 * @param {function} props.onModified - (result) => void, called after a successful modification so the parent can reload the booking
 */
export default function ModifyBookingScreen({ booking, bookingId, guestAccessToken, customerSessionToken, mapboxToken, onClose, onModified }) {
  const scheduled = new Date(booking.scheduledTime);
  const [pickupText, setPickupText] = useState(booking.pickup.address);
  const [pickupCoords, setPickupCoords] = useState({ lat: booking.pickup.lat, lng: booking.pickup.lng });
  const [dropoffText, setDropoffText] = useState(booking.dropoff.address);
  const [dropoffCoords, setDropoffCoords] = useState({ lat: booking.dropoff.lat, lng: booking.dropoff.lng });
  const [date, setDate] = useState(scheduled.toISOString().slice(0, 10));
  const [time, setTime] = useState(scheduled.toTimeString().slice(0, 5));
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState(null);
  const [session] = useState(() => createSearchSessionToken());

  async function handleSubmit(e) {
    e.preventDefault();
    if (!pickupCoords.lat || !dropoffCoords.lat) {
      setErrorMessage("Please pick an address from the suggestions list for both pickup and drop-off.");
      return;
    }
    setSaving(true);
    setErrorMessage("");
    const scheduledIso = new Date(`${date}T${time}`).toISOString();
    const outcome = await modifyBooking({
      bookingId,
      guestAccessToken,
      customerSessionToken,
      pickup: { address: pickupText, ...pickupCoords },
      dropoff: { address: dropoffText, ...dropoffCoords },
      scheduledTime: scheduledIso,
    });
    setSaving(false);
    if (outcome.error) {
      setErrorMessage(outcome.error);
      return;
    }
    setResult(outcome);
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}>
        <div className="w-full max-w-[380px] rounded-2xl p-6 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
          <CheckCircle2 size={32} color="var(--success-text)" className="mx-auto mb-3" />
          <div className="mb-1 text-base font-bold" style={{ color: "var(--text-primary)" }}>Booking updated</div>
          <div className="mb-4 text-sm" style={{ color: "var(--text-secondary)" }}>New fare: €{result.newFare.toFixed(2)}</div>
          {result.needsManualSettlement && (
            <div className="mb-4 rounded-lg p-3 text-xs" style={{ background: "var(--warning-bg)", color: "var(--warning-text)" }}>
              This change {result.fareDifference > 0 ? "increases" : "decreases"} your fare by €{Math.abs(result.fareDifference).toFixed(2)}.
              Since you already paid in full, please settle this difference directly with your driver.
            </div>
          )}
          <button
            onClick={() => onModified(result)}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white"
            style={{ background: "var(--accent-gradient)" }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--bg-page)" }}>
      <div className="mx-auto w-full max-w-[400px] p-5">
        <div className="mb-5 flex items-center gap-3">
          <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "var(--bg-card-alt)", boxShadow: "var(--shadow-btn)" }}>
            <ArrowLeft size={15} color="var(--text-secondary)" />
          </button>
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Modify booking</div>
        </div>

        <form onSubmit={handleSubmit}>
          <AddressField
            label="Pickup"
            value={pickupText}
            onChange={setPickupText}
            onSelect={(v) => { setPickupText(v.address); setPickupCoords({ lat: v.lat, lng: v.lng }); }}
            mapboxToken={mapboxToken}
            session={session}
          />
          <AddressField
            label="Drop-off"
            value={dropoffText}
            onChange={setDropoffText}
            onSelect={(v) => { setDropoffText(v.address); setDropoffCoords({ lat: v.lat, lng: v.lng }); }}
            mapboxToken={mapboxToken}
            session={session}
          />

          <div className="mb-5 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                <Calendar size={11} /> Date
              </label>
              <input
                type="date"
                value={date}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl p-3 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                <Clock size={11} /> Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-xl p-3 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }}
              />
            </div>
          </div>

          {errorMessage && (
            <div className="mb-4 flex items-center gap-1.5 rounded-lg p-2.5 text-xs" style={{ background: "var(--error-bg)", color: "var(--error-text)" }}>
              <AlertCircle size={13} /> {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--accent-gradient)", boxShadow: "var(--shadow-accent-btn)" }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
