// supabase/functions/_shared/driverAvailability.ts
//
// The single source of truth for "is this driver actually taking new
// bookings right now" — combines four independent signals, checked in
// this order:
//   1. SPSV licence verification (drivers.licence_verified) — an
//      unverified driver is ALWAYS blocked, full stop, regardless of
//      the other three signals below. This is a real gate added at
//      the owner's explicit request, not just a status badge.
//   2. Manual Online/Offline toggle (drivers.is_online)
//   3. An optional weekly working-hours schedule (drivers.working_hours)
//   4. A short timed break (drivers.break_until)
//
// PRECEDENCE: unverified beats everything. Below that, manual OFF
// always wins immediately. A break only matters if the driver is
// otherwise online (manually and per schedule).
//
// Originally lived only inside get-driver-availability/index.ts;
// pulled out here so create-booking can independently re-verify the
// exact same thing server-side before ever charging anyone — a
// passenger loading the booking form while the driver was online, then
// submitting after the driver went offline or on a break, must not
// slip through. Never trust that a client-side check from moments ago
// still holds by the time the real request lands.
//
// KNOWN LIMITATION (carried over unchanged): the working_hours check
// runs on this server's UTC clock, not necessarily the driver's own
// local timezone — could be off by up to an hour right at shift
// boundaries during Irish summer time.
//
// Requires:
//   ALTER TABLE drivers ADD COLUMN is_online boolean NOT NULL DEFAULT true;
//   ALTER TABLE drivers ADD COLUMN working_hours jsonb;
//   ALTER TABLE drivers ADD COLUMN break_until timestamptz;
// (licence_verified already existed from an earlier phase)

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface DriverAvailability {
  isOnline: boolean;
  breakUntil: string | null; // ISO string, only meaningful when isOnline is false because of an active break
  reason: "unverified" | "offline" | "schedule" | "break" | "available";
}

export async function getDriverAvailability(supabase: AnySupabaseClient, driverId: string): Promise<DriverAvailability> {
  const { data } = await supabase.from("drivers").select("is_online, working_hours, break_until, licence_verified").eq("id", driverId).maybeSingle();

  // Fails open (true) if the row is somehow missing — a driver isn't
  // accidentally hidden from bookings due to a data gap rather than a
  // deliberate choice. Verification itself does NOT fail open — a
  // missing/null licence_verified is treated as "not verified", the
  // safe default for a gate that exists specifically to protect
  // passengers.
  if (data && data.licence_verified !== true) {
    return { isOnline: false, breakUntil: null, reason: "unverified" };
  }

  const manualOnline = data?.is_online ?? true;
  let effectiveOnline = manualOnline;

  if (manualOnline && data?.working_hours) {
    const now = new Date();
    const todayKey = DAY_KEYS[now.getDay()];
    const todaySchedule = data.working_hours[todayKey];

    if (!todaySchedule) {
      effectiveOnline = false;
    } else {
      const [startH, startM] = todaySchedule.start.split(":").map(Number);
      const [endH, endM] = todaySchedule.end.split(":").map(Number);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      effectiveOnline = nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
  }

  const breakUntil: string | null = data?.break_until ?? null;
  const onBreak = effectiveOnline && breakUntil != null && new Date(breakUntil) > new Date();
  if (onBreak) effectiveOnline = false;

  let reason: DriverAvailability["reason"] = "available";
  if (!manualOnline) reason = "offline";
  else if (!effectiveOnline && !onBreak) reason = "schedule";
  else if (onBreak) reason = "break";

  return { isOnline: effectiveOnline, breakUntil: onBreak ? breakUntil : null, reason: effectiveOnline ? "available" : reason };
}
