import {
  adminCreateApiKeySchema,
  adminCreateTenantSchema,
  adminTenantIdParamSchema,
  adminTenantListQuerySchema,
  adminUpdateTenantSchema,
  adminUsageQuerySchema,
} from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  type AdminEnv,
  API_KEY_COLUMNS,
  type ApiKeyRow,
  adminDbError,
  adminError,
  TENANT_COLUMNS,
  type TenantRow,
  toAdminApiKey,
  toAdminTenant,
  writeAdminAudit,
} from "../../lib/admin";
import { generateApiKey } from "../../lib/api-key";
import { slugify } from "../../lib/slug";
import { createSupabaseClient } from "../../lib/supabase";
import { validationHook } from "../../lib/validation-hook";
import { jsonBodyLimit } from "../../middleware/body-limits";

export const adminTenants = new Hono<AdminEnv>();

function utcDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

adminTenants.get(
  "/",
  zValidator("query", adminTenantListQuerySchema, validationHook),
  async (c) => {
    const query = c.req.valid("query");
    const supabase = createSupabaseClient(c.env);

    let request = supabase
      .from("tenants")
      .select(TENANT_COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    if (query.status) {
      request = request.eq("status", query.status);
    }

    if (query.q) {
      request = request.or(
        `name.ilike."*${query.q}*",slug.ilike."*${query.q}*"`,
      );
    }

    const { data, error, count } = await request;

    if (error) {
      return adminDbError(c, "admin_tenant_list_failed", error);
    }

    const tenants = (data ?? []) as TenantRow[];
    const activeKeyCounts = new Map<string, number>();

    if (tenants.length > 0) {
      const { data: keys, error: keysError } = await supabase
        .from("api_keys")
        .select("tenant_id, expires_at")
        .eq("status", "active")
        .in(
          "tenant_id",
          tenants.map((tenant) => tenant.id),
        );

      if (keysError) {
        return adminDbError(c, "admin_tenant_key_counts_failed", keysError);
      }

      const now = Date.now();
      for (const key of keys ?? []) {
        if (key.expires_at && new Date(key.expires_at).getTime() <= now)
          continue;
        activeKeyCounts.set(
          key.tenant_id,
          (activeKeyCounts.get(key.tenant_id) ?? 0) + 1,
        );
      }
    }

    return c.json({
      data: tenants.map((tenant) => ({
        ...toAdminTenant(tenant),
        activeKeyCount: activeKeyCounts.get(tenant.id) ?? 0,
      })),
      total: count ?? tenants.length,
      limit: query.limit,
      offset: query.offset,
    });
  },
);

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

adminTenants.post(
  "/",
  jsonBodyLimit,
  zValidator("json", adminCreateTenantSchema, validationHook),
  async (c) => {
    const body = c.req.valid("json");
    const slug = body.slug ?? slugify(body.name);

    if (!slug) {
      return adminError(
        c,
        400,
        "VALIDATION_ERROR",
        "Could not derive a slug from the name. Provide a slug.",
      );
    }

    const supabase = createSupabaseClient(c.env);
    const { data, error } = await supabase
      .from("tenants")
      .insert({ name: body.name, slug, status: "active" })
      .select(TENANT_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return adminError(
          c,
          409,
          "SLUG_TAKEN",
          "A tenant with this slug already exists.",
        );
      }
      return adminDbError(c, "admin_tenant_create_failed", error);
    }

    const tenant = data as TenantRow;

    await writeAdminAudit(c, {
      action: "tenant.create",
      tenantId: tenant.id,
      targetType: "tenant",
      targetId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug },
    });

    return c.json({ data: toAdminTenant(tenant) }, 201);
  },
);

// ---------------------------------------------------------------------------
// DETAIL
// ---------------------------------------------------------------------------

adminTenants.get(
  "/:tenantId",
  zValidator("param", adminTenantIdParamSchema, validationHook),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from("tenants")
      .select(TENANT_COLUMNS)
      .eq("id", tenantId)
      .maybeSingle();

    if (error) {
      return adminDbError(c, "admin_tenant_get_failed", error);
    }

    if (!data) {
      return adminError(c, 404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    const [keysResult, usageResult] = await Promise.all([
      supabase
        .from("api_keys")
        .select("status, expires_at")
        .eq("tenant_id", tenantId),
      supabase
        .from("api_key_usage_daily")
        .select("request_count")
        .eq("tenant_id", tenantId)
        .gt("usage_date", utcDateDaysAgo(30)),
    ]);

    if (keysResult.error) {
      return adminDbError(
        c,
        "admin_tenant_keys_summary_failed",
        keysResult.error,
      );
    }

    if (usageResult.error) {
      return adminDbError(
        c,
        "admin_tenant_usage_summary_failed",
        usageResult.error,
      );
    }

    const now = Date.now();
    const keys = keysResult.data ?? [];
    const activeKeyCount = keys.filter(
      (key) =>
        key.status === "active" &&
        !(key.expires_at && new Date(key.expires_at).getTime() <= now),
    ).length;

    const requestsLast30Days = (usageResult.data ?? []).reduce(
      (sum, row) => sum + Number(row.request_count ?? 0),
      0,
    );

    return c.json({
      data: {
        ...toAdminTenant(data as TenantRow),
        activeKeyCount,
        totalKeyCount: keys.length,
        requestsLast30Days,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// UPDATE (name / status). No delete: archive instead.
// ---------------------------------------------------------------------------

adminTenants.patch(
  "/:tenantId",
  jsonBodyLimit,
  zValidator("param", adminTenantIdParamSchema, validationHook),
  zValidator("json", adminUpdateTenantSchema, validationHook),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    const body = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const { data: existing, error: existingError } = await supabase
      .from("tenants")
      .select(TENANT_COLUMNS)
      .eq("id", tenantId)
      .maybeSingle();

    if (existingError) {
      return adminDbError(c, "admin_tenant_get_failed", existingError);
    }

    if (!existing) {
      return adminError(c, 404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    const changes: Record<string, string> = {};
    if (body.name !== undefined) changes.name = body.name;
    if (body.status !== undefined) changes.status = body.status;

    const { data, error } = await supabase
      .from("tenants")
      .update(changes)
      .eq("id", tenantId)
      .select(TENANT_COLUMNS)
      .single();

    if (error) {
      return adminDbError(c, "admin_tenant_update_failed", error);
    }

    const before = existing as TenantRow;

    await writeAdminAudit(c, {
      action: "tenant.update",
      tenantId,
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        from: { name: before.name, status: before.status },
        to: changes,
      },
    });

    return c.json({ data: toAdminTenant(data as TenantRow) });
  },
);

// ---------------------------------------------------------------------------
// TENANT API KEYS
// ---------------------------------------------------------------------------

adminTenants.get(
  "/:tenantId/keys",
  zValidator("param", adminTenantIdParamSchema, validationHook),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantError) {
      return adminDbError(c, "admin_tenant_get_failed", tenantError);
    }

    if (!tenant) {
      return adminError(c, 404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    const { data, error } = await supabase
      .from("api_keys")
      .select(API_KEY_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      return adminDbError(c, "admin_key_list_failed", error);
    }

    return c.json({ data: ((data ?? []) as ApiKeyRow[]).map(toAdminApiKey) });
  },
);

adminTenants.post(
  "/:tenantId/keys",
  jsonBodyLimit,
  zValidator("param", adminTenantIdParamSchema, validationHook),
  zValidator("json", adminCreateApiKeySchema, validationHook),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    const body = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, status")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenantError) {
      return adminDbError(c, "admin_tenant_get_failed", tenantError);
    }

    if (!tenant) {
      return adminError(c, 404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    if (tenant.status !== "active") {
      return adminError(
        c,
        409,
        "TENANT_NOT_ACTIVE",
        "Keys can only be created for active tenants.",
      );
    }

    const generated = await generateApiKey();

    const { data, error } = await supabase
      .from("api_keys")
      .insert({
        tenant_id: tenantId,
        name: body.name,
        key_prefix: generated.keyPrefix,
        key_hash: generated.keyHash,
        permissions: body.permissions,
        status: "active",
        expires_at: body.expiresAt ?? null,
      })
      .select(API_KEY_COLUMNS)
      .single();

    if (error) {
      return adminDbError(c, "admin_key_create_failed", error);
    }

    const key = data as ApiKeyRow;

    await writeAdminAudit(c, {
      action: "api_key.create",
      tenantId,
      targetType: "api_key",
      targetId: key.id,
      metadata: {
        name: key.name,
        keyPrefix: key.key_prefix,
        permissions: body.permissions,
        expiresAt: key.expires_at,
      },
    });

    c.header("Cache-Control", "no-store");

    return c.json(
      {
        data: {
          key: toAdminApiKey(key),
          // Returned once. Never stored and never returned again.
          rawKey: generated.rawKey,
        },
      },
      201,
    );
  },
);

// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------

adminTenants.get(
  "/:tenantId/usage",
  zValidator("param", adminTenantIdParamSchema, validationHook),
  zValidator("query", adminUsageQuerySchema, validationHook),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    const query = c.req.valid("query");
    const supabase = createSupabaseClient(c.env);

    let request = supabase
      .from("api_key_usage_daily")
      .select("api_key_id, usage_date, request_count")
      .eq("tenant_id", tenantId)
      .gt("usage_date", utcDateDaysAgo(query.days))
      .order("usage_date", { ascending: true });

    if (query.keyId) {
      request = request.eq("api_key_id", query.keyId);
    }

    const { data, error } = await request;

    if (error) {
      return adminDbError(c, "admin_usage_get_failed", error);
    }

    const byDate = new Map<string, number>();
    const byKey = new Map<string, number>();
    let totalRequests = 0;

    for (const row of data ?? []) {
      const requests = Number(row.request_count ?? 0);
      totalRequests += requests;
      byDate.set(row.usage_date, (byDate.get(row.usage_date) ?? 0) + requests);
      byKey.set(row.api_key_id, (byKey.get(row.api_key_id) ?? 0) + requests);
    }

    return c.json({
      data: {
        tenantId,
        keyId: query.keyId ?? null,
        days: query.days,
        totalRequests,
        daily: [...byDate.entries()].map(([date, requests]) => ({
          date,
          requests,
        })),
        byKey: [...byKey.entries()]
          .map(([keyId, requests]) => ({ keyId, requests }))
          .sort((a, b) => b.requests - a.requests),
      },
    });
  },
);
