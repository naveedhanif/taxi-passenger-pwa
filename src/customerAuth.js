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

  const { data: customerRow, error: customerError } = await supabase
    .from("customers")
    .insert({
      user_id: authData.user.id,
      driver_id: driverId,
      name,
      phone,
      email,
    })
    .select("id")
    .single();

  if (customerError) {
    return { customerId: null, error: customerError.message };
  }

  return { customerId: customerRow.id, error: null };
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

