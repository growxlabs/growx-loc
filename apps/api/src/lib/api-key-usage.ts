import type { Bindings } from "../types/bindings";
import { createSupabaseClient } from "./supabase";

// Best-effort usage counter; runs in waitUntil so it never delays or fails a client request.
export async function recordApiKeyUsage(
  env: Bindings,
  apiKeyId: string,
  tenantId: string,
): Promise<void> {
  try {
    const supabase = createSupabaseClient(env);
    const { error } = await supabase.rpc("record_api_key_usage", {
      p_api_key_id: apiKeyId,
      p_tenant_id: tenantId,
    });

    if (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "api_key_usage_record_failed",
          apiKeyId,
          code: error.code,
          message: error.message,
        }),
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "api_key_usage_record_failed",
        apiKeyId,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
