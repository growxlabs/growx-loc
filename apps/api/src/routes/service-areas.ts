import {
  createServiceAreaSchema,
  serviceAreaIdParamSchema,
  updateServiceAreaSchema,
} from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { toServiceAreaResponse } from "../lib/service-area-response";
import { createSupabaseClient } from "../lib/supabase";
import { tenantOwnsLocation } from "../lib/tenant-location";
import { validationHook } from "../lib/validation-hook";
import { jsonBodyLimit } from "../middleware/body-limits";
import { requirePermission } from "../middleware/require-permission";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const serviceAreas = new Hono<Env>();

serviceAreas.post(
  "/",
  requirePermission("service-areas:write"),
  jsonBodyLimit,
  zValidator("json", createServiceAreaSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const input = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    if (input.locationId) {
      const ownsLocation = await tenantOwnsLocation(
        supabase,
        tenant.id,
        input.locationId,
      );

      if (!ownsLocation) {
        return c.json(
          {
            error: {
              code: "INVALID_LOCATION",
              message: "Location does not exist for this tenant.",
              requestId: c.get("requestId"),
            },
          },
          400,
        );
      }
    }

    const record: Record<string, unknown> =
      input.type === "radius"
        ? {
            tenant_id: tenant.id,
            location_id: input.locationId,
            name: input.name,
            area_type: "radius",
            radius_km: input.radiusKm,
            pincodes: null,
            geometry: null,
            metadata: input.metadata,
            status: "active",
          }
        : {
            tenant_id: tenant.id,
            location_id: input.locationId ?? null,
            name: input.name,
            area_type: "pincode_list",
            radius_km: null,
            pincodes: [...new Set(input.pincodes.map((value) => value.trim()))],
            geometry: null,
            metadata: input.metadata,
            status: "active",
          };

    const { data, error } = await supabase
      .from("service_areas")
      .insert(record)
      .select(`
        id,
        name,
        area_type,
        location_id,
        radius_km,
        pincodes,
        metadata,
        status,
        created_at,
        updated_at
      `)
      .single();

    if (error) {
      console.error("Create service area failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to create service area.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    return c.json(
      {
        data: toServiceAreaResponse(data),
      },
      201,
    );
  },
);

serviceAreas.get("/", requirePermission("service-areas:read"), async (c) => {
  const tenant = c.get("tenant");
  const supabase = createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from("service_areas")
    .select(`
        id,
        name,
        area_type,
        location_id,
        radius_km,
        pincodes,
        metadata,
        status,
        created_at,
        updated_at
      `)
    .eq("tenant_id", tenant.id)
    .eq("status", "active")
    .in("area_type", ["radius", "pincode_list"])
    .order("name", { ascending: true });

  if (error) {
    console.error("List service areas failed", {
      code: error.code,
      message: error.message,
    });

    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Unable to load service areas.",
          requestId: c.get("requestId"),
        },
      },
      500,
    );
  }

  return c.json({
    data: (data ?? []).map(toServiceAreaResponse),
  });
});

serviceAreas.get(
  "/:id",
  requirePermission("service-areas:read"),
  zValidator("param", serviceAreaIdParamSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from("service_areas")
      .select(`
        id,
        name,
        area_type,
        location_id,
        radius_km,
        pincodes,
        metadata,
        status,
        created_at,
        updated_at
      `)
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .in("area_type", ["radius", "pincode_list"])
      .maybeSingle();

    if (error) {
      console.error("Get service area failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to load service area.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    if (!data) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Service area not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    return c.json({
      data: toServiceAreaResponse(data),
    });
  },
);

serviceAreas.patch(
  "/:id",
  requirePermission("service-areas:write"),
  jsonBodyLimit,
  zValidator("param", serviceAreaIdParamSchema, validationHook),
  zValidator("json", updateServiceAreaSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const { data: existing, error: existingError } = await supabase
      .from("service_areas")
      .select("id, area_type")
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      console.error("Read service area failed", {
        code: existingError.code,
        message: existingError.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to update service area.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    if (!existing) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Service area not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    if (existing.area_type === "radius" && input.pincodes !== undefined) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Pincodes cannot be assigned to a radius service area.",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    }

    if (existing.area_type === "pincode_list" && input.radiusKm !== undefined) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Radius cannot be assigned to a pincode service area.",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    }

    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) {
      patch.name = input.name;
    }

    if (input.radiusKm !== undefined) {
      patch.radius_km = input.radiusKm;
    }

    if (input.pincodes !== undefined) {
      patch.pincodes = [
        ...new Set(input.pincodes.map((value) => value.trim())),
      ];
    }

    if (input.metadata !== undefined) {
      patch.metadata = input.metadata;
    }

    if (input.status !== undefined) {
      patch.status = input.status;
    }

    const { data, error } = await supabase
      .from("service_areas")
      .update(patch)
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .select(`
        id,
        name,
        area_type,
        location_id,
        radius_km,
        pincodes,
        metadata,
        status,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (error) {
      console.error("Update service area failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to update service area.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    if (!data) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Service area not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    return c.json({
      data: toServiceAreaResponse(data),
    });
  },
);

serviceAreas.delete(
  "/:id",
  requirePermission("service-areas:write"),
  zValidator("param", serviceAreaIdParamSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from("service_areas")
      .update({
        status: "inactive",
      })
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .neq("status", "inactive")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Delete service area failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to delete service area.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    if (!data) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Service area not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    return c.body(null, 204);
  },
);
