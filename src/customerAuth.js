import { supabase } from "./supabaseClient";

/**
 * Real Supabase Auth + customers-table wiring for the passenger app.
 *
 * IMPORTANT — matches the platform's core design decision: a customer
 * account is scoped to ONE driver. Signing up through Driver A's app
 * creates a customers row tied to driver A only. The same person
 * signing up later through Driver B's app creates a completely
 * separate, unrelated customers row — this is intentional, not a bug,
 * per the "no shared customer base" decision made earlier.
 *
 * NOT LIVE-TESTED against a real Supabase Auth call — same caveat as
 * the driver-side auth module. Follows the documented Auth API
 * exactly; first real test is an actual signup in a running browser.
 */

export async function signUpCustomer({ email, password, name, phone, driverId }) {
  const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

  if (authError) {
    return { customerId: null, error: authError.message };
  }
  if (!authData.user) {
    return { customerId: null, error: "Check your email to confirm your account before signing in." };
  }

  // The customers row is created server-side (signup-customer Edge
  // Function) rather than via a direct client insert here — that used
  // to fail with "new row violates row-level security policy for table
  // customers", either because email confirmation is required (so
  // there's no active session yet to satisfy an auth.uid()-based
  // policy) or because no INSERT policy permits it at all. The Edge
  // Function bypasses RLS with the service role key after
  // independently verifying the user_id is real, so it works
  // regardless of which case applies.
  const signupResult = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signup-customer`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        user_id: authData.user.id,
        email,
        name,
        phone: phone || null,
        driver_id: driverId,
      }),
    }
  ).then((r) => r.json());

  if (signupResult.error) {
    return { customerId: null, error: signupResult.error };
  }

  if (!authData.session) {
    // Email confirmation is required by this Supabase project — the
    // account + customer row both exist now, but the browser has no
    // active session until the passenger clicks the confirmation link.
    // Being explicit about this here instead of silently treating it
    // as "signed in" avoids a confusing state where the UI acts
    // authenticated but every subsequent request fails.
    return {
      customerId: signupResult.customerId,
      error: null,
      needsEmailConfirmation: true,
    };
  }

  return { customerId: signupResult.customerId, error: null };
}

export async function signInCustomer(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { customerId: null, error: error.message };
  }

  return { customerId: null, error: null, userId: data.user.id };
}

/**
 * A signed-in customer might have accounts with multiple drivers (each
 * a separate row) — this looks up the one for THIS driver's app
 * specifically, since that's the only context that matters here.
 */
export async function getCustomerForDriver(userId, driverId) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("user_id", userId)
    .eq("driver_id", driverId)
    .single();

  if (error) {
    return { customer: null, error: "No account found with this driver." };
  }

  return { customer: data, error: null };
}

export async function signOutCustomer() {
  await supabase.auth.signOut();
}

