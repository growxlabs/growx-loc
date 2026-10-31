import { adminAuditLogQuerySchema } from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type AdminEnv, adminDbError } from "../../lib/admin";
import { createSupabaseClient } from "../../lib/supabase";
import { validationHook } from "../../lib/validation-hook";
import { adminKeys } from "./keys";
import { adminTenants } from "./tenants";

export const admin = new Hono<AdminEnv>();

admin.get("/overview", async (c) => {
  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase.rpc("admin_overview");

  if (error) {
    return adminDbError(c, "admin_overview_failed", error);
  }

  return c.json({ data });
});

admin.get(
  "/audit-logs",
  zValidator("query", adminAuditLogQuerySchema, validationHook),
  async (c) => {
    const query = c.req.valid("query");
    const supabase = createSupabaseClient(c.env);

    let request = supabase
      .from("admin_audit_logs")
      .select(
        "id, actor_id, actor_email, action, tenant_id, target_type, target_id, metadata, request_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(query.limit);

    if (query.tenantId) {
      request = request.eq("tenant_id", query.tenantId);
    }

    if (query.before) {
      request = request.lt("created_at", query.before);
    }

    const { data, error } = await request;

    if (error) {
      return adminDbError(c, "admin_audit_list_failed", error);
    }

    const rows = data ?? [];

    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorEmail: row.actor_email,
        action: row.action,
        tenantId: row.tenant_id,
        targetType: row.target_type,
        targetId: row.target_id,
        metadata: row.metadata,
        requestId: row.request_id,
        createdAt: row.created_at,
      })),
      // Pass as ?before= to load the next page.
      nextBefore:
        rows.length === query.limit ? rows[rows.length - 1].created_at : null,
    });
  },
);

admin.route("/tenants", adminTenants);
admin.route("/keys", adminKeys);
