import { checkServiceAreaSchema } from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createSupabaseClient } from "../lib/supabase";
import { validationHook } from "../lib/validation-hook";
import { jsonBodyLimit } from "../middleware/body-limits";
import { requirePermission } from "../middleware/require-permission";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

type CheckServiceAreaRow = {
  service_area_id: string;
  service_area_name: string;
  area_type: "radius" | "pincode_list";
  location_id: string | null;
  location_name: string | null;
  distance_km: number | string | null;
};

export const serviceAreaCheck = new Hono<Env>();

serviceAreaCheck.post(
  "/",
  requirePermission("service-areas:read"),
  jsonBodyLimit,
  zValidator("json", checkServiceAreaSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const input = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase.rpc("check_service_area", {
      p_tenant_id: tenant.id,
      p_lat: input.coordinates?.lat ?? null,
      p_lng: input.coordinates?.lng ?? null,
      p_pincode: input.pincode?.trim() ?? null,
    });

    if (error) {
      console.error("Service area check failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to check service coverage.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    const rows = (data as CheckServiceAreaRow[] | null) ?? [];
    const matches = rows.map((row) => ({
      serviceAreaId: row.service_area_id,
      serviceAreaName: row.service_area_name,
      type: row.area_type,
      locationId: row.location_id,
      locationName: row.location_name,
      distanceKm:
        row.distance_km === null
          ? null
          : Number(Number(row.distance_km).toFixed(3)),
    }));

    return c.json({
      data: {
        covered: matches.length > 0,
        matches,
      },
    });
  },
);
