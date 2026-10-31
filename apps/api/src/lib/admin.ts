import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";
import { createSupabaseClient } from "./supabase";

export type AdminEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};

type AdminContext = Context<AdminEnv>;

export function adminError(
  c: AdminContext,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json(
    {
      error: {
        code,
        message,
        requestId: c.get("requestId"),
      },
    },
    status,
  );
}

export function adminDbError(
  c: AdminContext,
  event: string,
  error: { code?: string; message: string },
) {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      requestId: c.get("requestId"),
      code: error.code,
      message: error.message,
    }),
  );

  return adminError(c, 500, "INTERNAL_ERROR", "Admin operation failed.");
}

export type AuditEntry = {
  action: string;
  tenantId?: string | null;
  targetType: string;
  targetId?: string | null;
  // Never put raw keys or key hashes here.
  metadata?: Record<string, unknown>;
};

// Awaited (not waitUntil) so the audit row is written before the response is sent.
export async function writeAdminAudit(
  c: AdminContext,
  entry: AuditEntry,
): Promise<void> {
  const actor = c.get("adminActor");
  const supabase = createSupabaseClient(c.env);

  const { error } = await supabase.from("admin_audit_logs").insert({
    actor_id: actor.id,
    actor_email: actor.email,
    action: entry.action,
    tenant_id: entry.tenantId ?? null,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    request_id: c.get("requestId"),
  });

  if (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "admin_audit_write_failed",
        requestId: c.get("requestId"),
        action: entry.action,
        code: error.code,
        message: error.message,
      }),
    );
  }
}

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export const TENANT_COLUMNS = "id, name, slug, status, created_at, updated_at";

export function toAdminTenant(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ApiKeyRow = {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  permissions: unknown;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

// key_hash is deliberately excluded.
export const API_KEY_COLUMNS =
  "id, tenant_id, name, key_prefix, permissions, status, expires_at, last_used_at, created_at, updated_at";

export function toAdminApiKey(row: ApiKeyRow) {
  const expired =
    row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now();

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    status: row.status,
    // Effective state as /v1 auth sees it.
    usable: row.status === "active" && !expired,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
