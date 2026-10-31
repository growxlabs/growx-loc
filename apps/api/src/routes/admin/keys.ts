import {
  adminKeyIdParamSchema,
  adminRotateApiKeySchema,
} from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  type AdminEnv,
  API_KEY_COLUMNS,
  type ApiKeyRow,
  adminDbError,
  adminError,
  toAdminApiKey,
  writeAdminAudit,
} from "../../lib/admin";
import { generateApiKey } from "../../lib/api-key";
import { createSupabaseClient } from "../../lib/supabase";
import { validationHook } from "../../lib/validation-hook";
import { jsonBodyLimit } from "../../middleware/body-limits";

export const adminKeys = new Hono<AdminEnv>();

// ---------------------------------------------------------------------------
// REVOKE (idempotent)
// ---------------------------------------------------------------------------

adminKeys.post(
  "/:keyId/revoke",
  zValidator("param", adminKeyIdParamSchema, validationHook),
  async (c) => {
    const { keyId } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data: existing, error: existingError } = await supabase
      .from("api_keys")
      .select(API_KEY_COLUMNS)
      .eq("id", keyId)
      .maybeSingle();

    if (existingError) {
      return adminDbError(c, "admin_key_get_failed", existingError);
    }

    if (!existing) {
      return adminError(c, 404, "API_KEY_NOT_FOUND", "API key not found.");
    }

    const before = existing as ApiKeyRow;

    if (before.status === "revoked") {
      return c.json({ data: toAdminApiKey(before) });
    }

    const { data, error } = await supabase
      .from("api_keys")
      .update({ status: "revoked" })
      .eq("id", keyId)
      .select(API_KEY_COLUMNS)
      .single();

    if (error) {
      return adminDbError(c, "admin_key_revoke_failed", error);
    }

    await writeAdminAudit(c, {
      action: "api_key.revoke",
      tenantId: before.tenant_id,
      targetType: "api_key",
      targetId: keyId,
      metadata: { name: before.name, keyPrefix: before.key_prefix },
    });

    return c.json({ data: toAdminApiKey(data as ApiKeyRow) });
  },
);

// ---------------------------------------------------------------------------
// ROTATE (new key + grace period on the old one, atomic in SQL)
// ---------------------------------------------------------------------------

adminKeys.post(
  "/:keyId/rotate",
  jsonBodyLimit,
  zValidator("param", adminKeyIdParamSchema, validationHook),
  zValidator("json", adminRotateApiKeySchema, validationHook),
  async (c) => {
    const { keyId } = c.req.valid("param");
    const { graceHours } = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const { data: existing, error: existingError } = await supabase
      .from("api_keys")
      .select(
        `${API_KEY_COLUMNS}, tenant:tenants!api_keys_tenant_id_fkey (status)`,
      )
      .eq("id", keyId)
      .maybeSingle();

    if (existingError) {
      return adminDbError(c, "admin_key_get_failed", existingError);
    }

    if (!existing) {
      return adminError(c, 404, "API_KEY_NOT_FOUND", "API key not found.");
    }

    const tenant = Array.isArray(existing.tenant)
      ? existing.tenant[0]
      : existing.tenant;

    if (tenant?.status !== "active") {
      return adminError(
        c,
        409,
        "TENANT_NOT_ACTIVE",
        "Keys can only be rotated for active tenants.",
      );
    }

    const generated = await generateApiKey();

    const { data, error } = await supabase
      .rpc("rotate_api_key", {
        p_old_key_id: keyId,
        p_key_prefix: generated.keyPrefix,
        p_key_hash: generated.keyHash,
        p_grace_hours: graceHours,
      })
      .single();

    if (error) {
      if (error.message.includes("API_KEY_NOT_FOUND")) {
        return adminError(c, 404, "API_KEY_NOT_FOUND", "API key not found.");
      }
      if (error.message.includes("API_KEY_NOT_ACTIVE")) {
        return adminError(
          c,
          409,
          "API_KEY_NOT_ACTIVE",
          "Only active, unexpired keys can be rotated.",
        );
      }
      return adminDbError(c, "admin_key_rotate_failed", error);
    }

    const newKey = data as ApiKeyRow;

    const { data: oldKey, error: oldKeyError } = await supabase
      .from("api_keys")
      .select(API_KEY_COLUMNS)
      .eq("id", keyId)
      .single();

    if (oldKeyError) {
      // The rotation is committed; still return the new raw key so it is not lost.
      console.error(
        JSON.stringify({
          level: "error",
          event: "admin_key_rotate_reload_failed",
          requestId: c.get("requestId"),
          message: oldKeyError.message,
        }),
      );
    }

    await writeAdminAudit(c, {
      action: "api_key.rotate",
      tenantId: newKey.tenant_id,
      targetType: "api_key",
      targetId: keyId,
      metadata: {
        newKeyId: newKey.id,
        newKeyPrefix: newKey.key_prefix,
        oldKeyPrefix: (existing as ApiKeyRow).key_prefix,
        graceHours,
      },
    });

    c.header("Cache-Control", "no-store");

    return c.json({
      data: {
        key: toAdminApiKey(newKey),
        // Returned once. Never stored and never returned again.
        rawKey: generated.rawKey,
        previousKey: oldKey ? toAdminApiKey(oldKey as ApiKeyRow) : null,
      },
    });
  },
);
