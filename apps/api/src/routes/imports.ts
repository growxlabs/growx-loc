import {
  createLocationSchema,
  importIdParamSchema,
} from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { parseLocationCsv } from "../lib/import-csv";
import { csvRowToLocationInput } from "../lib/import-row";
import { resolveLocationType } from "../lib/location-type";
import { slugify } from "../lib/slug";
import { createSupabaseClient } from "../lib/supabase";
import { validationHook } from "../lib/validation-hook";
import { importBodyLimit } from "../middleware/body-limits";
import { requirePermission } from "../middleware/require-permission";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const imports = new Hono<Env>();

imports.post(
  "/locations",
  requirePermission("imports:write"),
  importBodyLimit,
  async (c) => {
    const tenant = c.get("tenant");
    const supabase = createSupabaseClient(c.env);

    const body = await c.req.parseBody();

    const uploaded = body.file;

    if (!(uploaded instanceof File)) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "A CSV or JSON file is required.",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    }

    if (uploaded.size > MAX_IMPORT_BYTES) {
      return c.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: "Import file must be 5 MB or smaller.",
            requestId: c.get("requestId"),
          },
        },
        413,
      );
    }

    const lowerName = uploaded.name.toLowerCase();

    const format = lowerName.endsWith(".csv")
      ? "csv"
      : lowerName.endsWith(".json")
        ? "json"
        : null;

    if (!format) {
      return c.json(
        {
          error: {
            code: "UNSUPPORTED_FILE",
            message: "Only CSV and JSON files are supported.",
            requestId: c.get("requestId"),
          },
        },
        415,
      );
    }

    const importId = crypto.randomUUID();

    const safeName = uploaded.name
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 180);

    const storagePath = `${tenant.id}/${importId}/${safeName}`;

    const bytes = new Uint8Array(await uploaded.arrayBuffer());

    const { error: storageError } = await supabase.storage
      .from("location-imports")
      .upload(storagePath, bytes, {
        contentType:
          uploaded.type || (format === "csv" ? "text/csv" : "application/json"),
        upsert: false,
      });

    if (storageError) {
      console.error("Import upload failed", {
        message: storageError.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to store import file.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    const { error: importCreateError } = await supabase
      .from("location_imports")
      .insert({
        id: importId,
        tenant_id: tenant.id,
        file_name: uploaded.name,
        storage_path: storagePath,
        file_format: format,
        status: "processing",
        started_at: new Date().toISOString(),
      });

    if (importCreateError) {
      await supabase.storage.from("location-imports").remove([storagePath]);

      console.error("Import record creation failed", {
        code: importCreateError.code,
        message: importCreateError.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to create import.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }

    try {
      const text = new TextDecoder().decode(bytes);

      const rawRows: unknown[] =
        format === "csv"
          ? parseLocationCsv(text).map(csvRowToLocationInput)
          : JSON.parse(text);

      if (!Array.isArray(rawRows)) {
        throw new Error("Import JSON must contain an array.");
      }

      const errors: Array<{
        row: number;
        message: string;
      }> = [];

      let insertedRows = 0;
      let updatedRows = 0;

      for (let index = 0; index < rawRows.length; index += 1) {
        const parsed = createLocationSchema.safeParse(rawRows[index]);

        if (!parsed.success) {
          errors.push({
            row: index + 1,
            message: parsed.error.issues
              .map((issue) => issue.message)
              .join("; "),
          });

          continue;
        }

        const input = parsed.data;

        const locationTypeId = await resolveLocationType(
          supabase,
          tenant.id,
          input.locationType,
        );

        if (!locationTypeId) {
          errors.push({
            row: index + 1,
            message: `Unknown location type: ${input.locationType}`,
          });

          continue;
        }

        const slug = input.slug ?? slugify(input.name);

        if (!slug) {
          errors.push({
            row: index + 1,
            message: "Unable to generate slug.",
          });

          continue;
        }

        const { data: existing, error: existingError } = await supabase
          .from("locations")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("slug", slug)
          .maybeSingle();

        if (existingError) {
          throw existingError;
        }

        const record = {
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
        };

        if (existing) {
          const { error } = await supabase
            .from("locations")
            .update(record)
            .eq("tenant_id", tenant.id)
            .eq("id", existing.id);

          if (error) {
            errors.push({
              row: index + 1,
              message: "Database update failed.",
            });

            continue;
          }

          updatedRows += 1;
        } else {
          const { error } = await supabase.from("locations").insert(record);

          if (error) {
            errors.push({
              row: index + 1,
              message: "Database insert failed.",
            });

            continue;
          }

          insertedRows += 1;
        }
      }

      const status =
        errors.length === rawRows.length && rawRows.length > 0
          ? "failed"
          : "completed";

      await supabase
        .from("location_imports")
        .update({
          status,
          total_rows: rawRows.length,
          inserted_rows: insertedRows,
          updated_rows: updatedRows,
          failed_rows: errors.length,
          error_summary: errors.slice(0, 100),
          completed_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenant.id)
        .eq("id", importId);

      return c.json(
        {
          data: {
            id: importId,
            status,
            totalRows: rawRows.length,
            insertedRows,
            updatedRows,
            failedRows: errors.length,
            errors: errors.slice(0, 100),
          },
        },
        201,
      );
    } catch (error) {
      console.error("Location import failed", error);

      await supabase
        .from("location_imports")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_summary: [
            {
              row: 0,
              message: "Import processing failed.",
            },
          ],
        })
        .eq("tenant_id", tenant.id)
        .eq("id", importId);

      return c.json(
        {
          error: {
            code: "IMPORT_FAILED",
            message: "Unable to process import file.",
            requestId: c.get("requestId"),
          },
        },
        400,
      );
    }
  },
);

imports.get(
  "/:id",
  requirePermission("imports:read"),
  zValidator("param", importIdParamSchema, validationHook),
  async (c) => {
    const tenant = c.get("tenant");
    const { id } = c.req.valid("param");
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from("location_imports")
      .select(`
        id,
        file_name,
        file_format,
        status,
        total_rows,
        inserted_rows,
        updated_rows,
        failed_rows,
        error_summary,
        created_at,
        started_at,
        completed_at
      `)
      .eq("tenant_id", tenant.id)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Get import failed", {
        code: error.code,
        message: error.message,
      });

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to load import.",
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
            message: "Import not found.",
            requestId: c.get("requestId"),
          },
        },
        404,
      );
    }

    return c.json({
      data: {
        id: data.id,
        fileName: data.file_name,
        fileFormat: data.file_format,
        status: data.status,
        totalRows: data.total_rows,
        insertedRows: data.inserted_rows,
        updatedRows: data.updated_rows,
        failedRows: data.failed_rows,
        errors: data.error_summary,
        createdAt: data.created_at,
        startedAt: data.started_at,
        completedAt: data.completed_at,
      },
    });
  },
);
