import { createSupabaseClient, createGlobalSupabaseClient } from "./supabase";
import type { Bindings } from "../types/bindings";

export type PingResult = {
  db1Core: boolean;
  db2Global: boolean;
  d1Reference: boolean;
  timestamp: string;
  errors: Record<string, string>;
};

export async function pingDatabases(env: Bindings): Promise<PingResult> {
  const result: PingResult = {
    db1Core: false,
    db2Global: false,
    d1Reference: false,
    timestamp: new Date().toISOString(),
    errors: {},
  };

  // 1. Keep Supabase DB1 (Core / Tenants) active
  try {
    const supabase = createSupabaseClient(env);
    const { error } = await supabase.from("tenants").select("id").limit(1);
    if (error) {
      result.errors.db1Core = error.message;
    } else {
      result.db1Core = true;
    }
  } catch (err) {
    result.errors.db1Core = err instanceof Error ? err.message : String(err);
  }

  // 2. Keep Supabase DB2 (Global Intelligence POIs) active
  try {
    const supabaseGlobal = createGlobalSupabaseClient(env);
    const { error } = await supabaseGlobal.from("global_places").select("id").limit(1);
    if (error) {
      result.errors.db2Global = error.message;
    } else {
      result.db2Global = true;
    }
  } catch (err) {
    result.errors.db2Global = err instanceof Error ? err.message : String(err);
  }

  // 3. Keep Cloudflare D1 active
  try {
    if (env.REFERENCE_DB) {
      await env.REFERENCE_DB.prepare("SELECT 1;").run();
      result.d1Reference = true;
    }
  } catch (err) {
    result.errors.d1Reference = err instanceof Error ? err.message : String(err);
  }

  return result;
}
