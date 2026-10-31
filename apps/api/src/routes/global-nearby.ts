import { globalNearbyQuerySchema } from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createGlobalSupabaseClient } from "../lib/supabase";
import { validationHook } from "../lib/validation-hook";
import { requirePermission } from "../middleware/require-permission";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const globalNearby = new Hono<Env>();

globalNearby.get(
  "/",
  requirePermission("locations:read"),
  zValidator("query", globalNearbyQuerySchema, validationHook),
  async (c) => {
    const query = c.req.valid("query");
    const supabaseGlobal = createGlobalSupabaseClient(c.env);

    const { data, error } = await supabaseGlobal.rpc("nearby_global_places", {
      p_lat: query.lat,
      p_lng: query.lng,
      p_radius_km: query.radius,
      p_category: query.category ?? null,
      p_limit: query.limit,
    });

    if (error) {
      console.error("Global nearby places lookup failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to find nearby global places.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    const places = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      basicCategory: row.basic_category ?? null,
      brandName: row.brand_name ?? null,
      confidence: row.confidence ?? null,
      locality: row.locality ?? null,
      district: row.district ?? null,
      state: row.state ?? null,
      pincode: row.pincode ?? null,
      countryCode: row.country_code ?? "IN",
      latitude: row.latitude,
      longitude: row.longitude,
      address: row.address ?? null,
      phone: row.phone ?? null,
      website: row.website ?? null,
      source: row.source ?? "overture",
      source_id: row.source_id ?? row.id,
      distanceKm: row.distance_km,
    }));

    return c.json({
      data: places,
      origin: {
        lat: query.lat,
        lng: query.lng,
      },
      radiusKm: query.radius,
      category: query.category ?? null,
      limit: query.limit,
      count: places.length,
    });
  },
);
