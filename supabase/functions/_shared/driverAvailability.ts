// supabase/functions/_shared/driverAvailability.ts
//
// The single source of truth for "is this driver actually taking new
// bookings right now" — combines three independent signals:
//   1. Manual Online/Offline toggle (drivers.is_online)
//   2. An optional weekly working-hours schedule (drivers.working_hours)
//   3. A short timed break (drivers.break_until) — distinct from fully
//      going offline; auto-expires on its own once the time passes,
//      no separate cleanup needed.
//
// PRECEDENCE: manual OFF always wins immediately, same as before this
// existed. A break only matters if the driver is otherwise online
// (manually and per schedule) — being on a break while also manually
// offline is simply "offline", nothing new to layer on.
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
// (the first two may already exist from earlier deploys)

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface DriverAvailability {
  isOnline: boolean;
  breakUntil: string | null; // ISO string, only meaningful when isOnline is false because of an active break
}

export async function getDriverAvailability(supabase: AnySupabaseClient, driverId: string): Promise<DriverAvailability> {
  const { data } = await supabase.from("drivers").select("is_online, working_hours, break_until").eq("id", driverId).maybeSingle();

  // Fails open (true) if the row is somehow missing — a driver isn't
  // accidentally hidden from bookings due to a data gap rather than a
  // deliberate choice.
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

  return { isOnline: effectiveOnline, breakUntil: onBreak ? breakUntil : null };
}
