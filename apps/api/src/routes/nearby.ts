import { nearbyLocationsQuerySchema } from "@growx-loc/validation";
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

export const nearby = new Hono<Env>();

nearby.get(
  "/",
  requirePermission("locations:read"),
  zValidator("query", nearbyLocationsQuerySchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const query = c.req.valid("query");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase.rpc("nearby_locations", {
      p_tenant_id: tenant.id,
      p_lat: query.lat,
      p_lng: query.lng,
      p_radius_km: query.radius,
      p_type: query.type ?? null,
      p_limit: query.limit,
    });

    if (error) {
      console.error("Nearby location lookup failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to find nearby locations.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    return c.json({
      data: (data ?? []).map(toLocationResponse),
      origin: {
        lat: query.lat,
        lng: query.lng,
      },
      radiusKm: query.radius,
    });
  },
);
