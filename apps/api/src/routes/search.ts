import { searchLocationsQuerySchema } from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { toLocationResponse } from "../lib/location-response";
import { createSupabaseClient } from "../lib/supabase";
import { validationHook } from "../lib/validation-hook";
import { requirePermission } from "../middleware/require-permission";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const search = new Hono<Env>();

search.get(
  "/",
  requirePermission("locations:read"),
  zValidator("query", searchLocationsQuerySchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const query = c.req.valid("query");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase.rpc("search_locations", {
      p_tenant_id: tenant.id,
      p_query: query.q,
      p_type: query.type ?? null,
      p_limit: query.limit,
    });

    if (error) {
      console.error("Location search failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to search locations.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    return c.json({
      data: (data ?? []).map(toLocationResponse),
      query: query.q,
    });
  },
);
