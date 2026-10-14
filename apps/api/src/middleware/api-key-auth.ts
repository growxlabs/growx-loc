import type { MiddlewareHandler } from "hono";
import { hashApiKey, isGrowxApiKey } from "../lib/api-key";
import { createSupabaseClient } from "../lib/supabase";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const apiKeyAuth: MiddlewareHandler<Env> = async (c, next) => {
  const authorization = c.req.header("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Missing API key.",
          requestId: c.get("requestId"),
        },
      },
      401,
    );
  }

  const rawApiKey = authorization.slice("Bearer ".length).trim();

  if (!isGrowxApiKey(rawApiKey)) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key.",
          requestId: c.get("requestId"),
        },
      },
      401,
    );
  }

  const keyHash = await hashApiKey(rawApiKey);
  const supabase = createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from("api_keys")
    .select(`
      id,
      permissions,
      status,
      expires_at,
      tenant:tenants!api_keys_tenant_id_fkey (
        id,
        name,
        slug,
        status
      )
    `)
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error) {
    console.error("API key lookup failed", {
      code: error.code,
      message: error.message,
    });

    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Authentication service unavailable.",
          requestId: c.get("requestId"),
        },
      },
      500,
    );
  }

  if (data?.status !== "active") {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key.",
          requestId: c.get("requestId"),
        },
      },
      401,
    );
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "API key expired.",
          requestId: c.get("requestId"),
        },
      },
      401,
    );
  }

  const tenant = Array.isArray(data.tenant) ? data.tenant[0] : data.tenant;

  if (tenant?.status !== "active") {
    return c.json(
      {
        error: {
          code: "TENANT_UNAVAILABLE",
          message: "Tenant is unavailable.",
          requestId: c.get("requestId"),
        },
      },
      403,
    );
  }

  const permissions = Array.isArray(data.permissions)
    ? data.permissions.filter(
        (permission): permission is string => typeof permission === "string",
      )
    : [];

  c.set("tenant", {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
  });

  c.set("apiKey", {
    id: data.id,
    permissions,
  });

  await next();
};
