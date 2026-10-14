import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveLocationType(
  supabase: SupabaseClient,
  tenantId: string,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("location_types")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}
