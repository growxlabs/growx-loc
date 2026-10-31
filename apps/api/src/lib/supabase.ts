import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types/bindings";

export function createSupabaseClient(env: Bindings) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createGlobalSupabaseClient(env: Bindings) {
  return createClient(env.SUPABASE_GLOBAL_URL, env.SUPABASE_GLOBAL_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
