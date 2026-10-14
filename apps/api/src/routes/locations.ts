import {
  createLocationSchema,
  listLocationsQuerySchema,
  locationIdParamSchema,
  updateLocationSchema,
} from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { toLocationResponse } from "../lib/location-response";
import { resolveLocationType } from "../lib/location-type";
import { slugify } from "../lib/slug";
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

export const locations = new Hono<Env>();

locations.get(
  "/",
  requirePermission("locations:read"),
  zValidator("query", listLocationsQuerySchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const query = c.req.valid("query");
    const supabase = createSupabaseClient(c.env);

    let request = supabase
      .from("locations")
      .select(`
        id,
        name,
        slug,
        address_line_1,
        address_line_2,
        locality,
        city,
        district,
        state,
        pincode,
        country_code,
        latitude,
        longitude,
        phone,
        whatsapp,
        email,
        website,
        metadata,
        location_type:location_types!locations_location_type_id_fkey (
          slug
        )
      `)
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .range(query.offset, query.offset + query.limit - 1)
      .order("name", { ascending: true });

    if (query.city) {
      request = request.ilike("city", query.city);
    }

    if (query.state) {
      request = request.ilike("state", query.state);
    }

    if (query.pincode) {
      request = request.eq("pincode", query.pincode);
    }

    if (query.type) {
      request = request.eq("location_types.slug", query.type);
    }

    const { data, error } = await request;

    if (error) {
      console.error("List locations failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to load locations.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    const rows = (data ?? []).map((row) => {
      const locType = row.location_type as
        | { slug?: string }
        | Array<{ slug?: string }>
        | null
        | undefined;
      const type = Array.isArray(locType) ? locType[0]?.slug : locType?.slug;

      return toLocationResponse({
        ...row,
        location_type: type ?? "unknown",
      });
    });

    return c.json({
      data: rows,
      pagination: {
        limit: query.limit,
        offset: query.offset,
        returned: rows.length,
      },
    });
  },
);

locations.get(
  "/:id",
  requirePermission("locations:read"),
  zValidator("param", locationIdParamSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from("locations")
      .select(`
        id,
        name,
        slug,
        address_line_1,
        address_line_2,
        locality,
        city,
        district,
        state,
        pincode,
        country_code,
        latitude,
        longitude,
        phone,
        whatsapp,
        email,
        website,
        metadata,
        location_type:location_types!locations_location_type_id_fkey (
          slug
        )
      `)
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      console.error("Get location failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to load location.",
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
            message: "Location not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    const locType = data.location_type as
      | { slug?: string }
      | Array<{ slug?: string }>
      | null
      | undefined;
    const type = Array.isArray(locType) ? locType[0]?.slug : locType?.slug;

    return c.json({
      data: toLocationResponse({
        ...data,
        location_type: type ?? "unknown",
      }),
    });
  },
);

locations.post(
  "/",
  requirePermission("locations:write"),
  jsonBodyLimit,
  zValidator("json", createLocationSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const input = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const locationTypeId = await resolveLocationType(
      supabase,
      tenant.id,
      input.locationType,
    );

    if (!locationTypeId) {
      return c.json(
        {
          error: {
            code: "INVALID_LOCATION_TYPE",
            message: "Location type does not exist for this tenant.",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    }

    const slug = input.slug ?? slugify(input.name);

    if (!slug) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Unable to generate a valid slug.",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    }

    const { data, error } = await supabase
      .from("locations")
      .insert({
        tenant_id: tenant.id,
        location_type_id: locationTypeId,

        name: input.name,
        slug,

        address_line_1: input.address.line1 ?? null,
        address_line_2: input.address.line2 ?? null,
        locality: input.address.locality ?? null,
        city: input.address.city ?? null,
        district: input.address.district ?? null,
        state: input.address.state,
        pincode: input.address.pincode ?? null,
        country_code: input.address.countryCode,

        latitude: input.coordinates.lat,
        longitude: input.coordinates.lng,

        phone: input.contact.phone ?? null,
        whatsapp: input.contact.whatsapp ?? null,
        email: input.contact.email ?? null,
        website: input.contact.website ?? null,

        metadata: input.metadata,
        status: input.status,
      })
      .select(`
        id,
        name,
        slug,
        address_line_1,
        address_line_2,
        locality,
        city,
        district,
        state,
        pincode,
        country_code,
        latitude,
        longitude,
        phone,
        whatsapp,
        email,
        website,
        metadata,
        location_type:location_types!locations_location_type_id_fkey (
          slug
        )
      `)
      .single();

    if (error) {
      if (error.code === "23505") {
        return c.json(
          {
            error: {
              code: "CONFLICT",
              message: "A location with this slug already exists.",
              requestId: c.get("requestId"),
            },
          },
          409,
        );
      }

      console.error("Create location failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to create location.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    const locType = data.location_type as
      | { slug?: string }
      | Array<{ slug?: string }>
      | null
      | undefined;
    const type = Array.isArray(locType) ? locType[0]?.slug : locType?.slug;

    return c.json(
      {
        data: toLocationResponse({
          ...data,
          location_type: type ?? input.locationType,
        }),
      },
      201,
    );
  },
);

locations.patch(
  "/:id",
  requirePermission("locations:write"),
  jsonBodyLimit,
  zValidator("param", locationIdParamSchema, validationHook),
  zValidator("json", updateLocationSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const supabase = createSupabaseClient(c.env);

    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.status !== undefined) patch.status = input.status;
    if (input.metadata !== undefined) patch.metadata = input.metadata;

    if (input.address) {
      if ("line1" in input.address) {
        patch.address_line_1 = input.address.line1 ?? null;
      }

      if ("line2" in input.address) {
        patch.address_line_2 = input.address.line2 ?? null;
      }

      if ("locality" in input.address) {
        patch.locality = input.address.locality ?? null;
      }

      if ("city" in input.address) {
        patch.city = input.address.city ?? null;
      }

      if ("district" in input.address) {
        patch.district = input.address.district ?? null;
      }

      if ("state" in input.address) {
        patch.state = input.address.state;
      }

      if ("pincode" in input.address) {
        patch.pincode = input.address.pincode ?? null;
      }

      if ("countryCode" in input.address) {
        patch.country_code = input.address.countryCode;
      }
    }

    if (input.coordinates) {
      if (input.coordinates.lat !== undefined) {
        patch.latitude = input.coordinates.lat;
      }

      if (input.coordinates.lng !== undefined) {
        patch.longitude = input.coordinates.lng;
      }
    }

    if (input.contact) {
      if ("phone" in input.contact) {
        patch.phone = input.contact.phone ?? null;
      }

      if ("whatsapp" in input.contact) {
        patch.whatsapp = input.contact.whatsapp ?? null;
      }

      if ("email" in input.contact) {
        patch.email = input.contact.email ?? null;
      }

      if ("website" in input.contact) {
        patch.website = input.contact.website ?? null;
      }
    }

    if (input.locationType !== undefined) {
      const locationTypeId = await resolveLocationType(
        supabase,
        tenant.id,
        input.locationType,
      );

      if (!locationTypeId) {
        return c.json(
          {
            error: {
              code: "INVALID_LOCATION_TYPE",
              message: "Location type does not exist for this tenant.",
              requestId: c.get("requestId"),
            },
          },
          400,
        );
      }

      patch.location_type_id = locationTypeId;
    }

    const { data, error } = await supabase
      .from("locations")
      .update(patch)
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .select(`
        id,
        name,
        slug,
        address_line_1,
        address_line_2,
        locality,
        city,
        district,
        state,
        pincode,
        country_code,
        latitude,
        longitude,
        phone,
        whatsapp,
        email,
        website,
        metadata,
        location_type:location_types!locations_location_type_id_fkey (
          slug
        )
      `)
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return c.json(
          {
            error: {
              code: "CONFLICT",
              message: "A location with this slug already exists.",
              requestId: c.get("requestId"),
            },
          },
          409,
        );
      }

      console.error("Update location failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to update location.",
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
            message: "Location not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    const locType = data.location_type as
      | { slug?: string }
      | Array<{ slug?: string }>
      | null
      | undefined;
    const type = Array.isArray(locType) ? locType[0]?.slug : locType?.slug;

    return c.json({
      data: toLocationResponse({
        ...data,
        location_type: type ?? input.locationType ?? "unknown",
      }),
    });
  },
);

locations.delete(
  "/:id",
  requirePermission("locations:write"),
  zValidator("param", locationIdParamSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from("locations")
      .update({
        status: "inactive",
      })
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .neq("status", "inactive")
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Delete location failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to delete location.",
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
            message: "Location not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    return c.body(null, 204);
  },
);
