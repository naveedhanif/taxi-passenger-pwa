import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Subscribes to real-time updates for one booking: its status
 * (pending/confirmed/en_route/arrived/completed/canceled) and the
 * driver's live position, via Supabase Realtime (Postgres Changes).
 *
 * Realtime respects RLS — this only works because of the
 * tracking_select_for_active_customer policy added during the
 * security hardening pass. A customer subscribing to a driver they
 * have no active booking with simply receives nothing, silently,
 * same as a direct query would return zero rows.
 *
 * NOT LIVE-TESTED against a real websocket connection — this sandbox
 * has no network path to Supabase's realtime endpoint. The
 * subscription code follows Supabase's documented Realtime API
 * exactly; the first real test is running this in an actual browser
 * with a real booking.
 *
 * @param {string|null} bookingId - pass null to stay in demo mode
 * @param {string|null} driverId - needed to subscribe to live_tracking
 */
export function useBookingRealtime(bookingId, driverId) {
  const [status, setStatus] = useState("confirmed");
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!bookingId) return; // demo mode — caller manages status itself

    // Get the current status once, immediately, don't wait for the
    // first change event (which might never come if nothing changes).
    supabase
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single()
      .then(({ data }) => {
        if (data) setStatus(data.status);
      });

    const bookingChannel = supabase
      .channel(`booking-status-${bookingId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bookings", filter: `id=eq.${bookingId}` },
        (payload) => setStatus(payload.new.status)
      )
      .subscribe();

    let trackingChannel;
    if (driverId) {
      supabase
        .from("live_tracking")
        .select("lat, lng")
        .eq("driver_id", driverId)
        .single()
        .then(({ data }) => {
          if (data) setPosition(data);
        });

      trackingChannel = supabase
        .channel(`driver-position-${driverId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "live_tracking", filter: `driver_id=eq.${driverId}` },
          (payload) => setPosition({ lat: payload.new.lat, lng: payload.new.lng })
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(bookingChannel);
      if (trackingChannel) supabase.removeChannel(trackingChannel);
    };
  }, [bookingId, driverId]);

  return { status, position };
}

