import type { SupabaseClient } from "@supabase/supabase-js";

export async function tenantOwnsLocation(
  supabase: SupabaseClient,
  tenantId: string,
  locationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", locationId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}
