import { createClient } from "@supabase/supabase-js";

// True when the page was opened from a password-reset email link. Read
// synchronously here, before supabase-js processes and clears the URL hash.
export const OPENED_FROM_RECOVERY_LINK =
  typeof window !== "undefined" && /type=recovery/.test(window.location.hash);

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

