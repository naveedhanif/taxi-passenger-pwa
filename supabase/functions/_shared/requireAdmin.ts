// supabase/functions/_shared/requireAdmin.ts
//
// Every owner-facing edge function needs the exact same check: is
// whoever's asking actually a row in admin_users? Pulled out once
// here rather than repeated five times, so there's exactly one place
// that defines what "being an owner" means.
//
// There is deliberately no signup path that can create an admin_users
// row — see owner-01-schema.sql's header comment. This function only
// ever checks for existence, never creates one.
//
// Returns BOTH adminId (admin_users.id) and userId (auth.users.id) —
// they're different values for different purposes. Confirmed via
// pg_constraint (not guessed) that drivers.licence_verified_by
// references auth.users(id) directly, not admin_users.id — an earlier
// version of review-driver-licence wrote the wrong one of these and
// hit "violates foreign key constraint drivers_licence_verified_by_fkey"
// the first time it was actually used. Any future column tracking
// "which admin did this" needs the same care about which of these two
// IDs it actually expects, rather than assuming.

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export async function requireAdmin(
  supabase: AnySupabaseClient,
  authHeader: string | null
): Promise<{ adminId: string; userId: string } | { error: string; status: number }> {
  if (!authHeader) return { error: "Not signed in", status: 401 };

  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (userError || !userData?.user) return { error: "Not signed in", status: 401 };

  const { data: admin } = await supabase.from("admin_users").select("id").eq("user_id", userData.user.id).maybeSingle();
  if (!admin) return { error: "Not authorized — this account doesn't have owner access", status: 403 };

  return { adminId: admin.id, userId: userData.user.id };
}
