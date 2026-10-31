import { divisionsSearchQuerySchema } from "@growx-loc/validation";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { validationHook } from "../lib/validation-hook";
import { requirePermission } from "../middleware/require-permission";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

function escapeLikePattern(val: string): string {
  return val
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export const divisionsSearch = new Hono<Env>();

divisionsSearch.get(
  "/",
  requirePermission("locations:read"),
  zValidator("query", divisionsSearchQuerySchema, validationHook),
  async (c) => {
    const query = c.req.valid("query");
    const escapedQ = escapeLikePattern(query.q);

    try {
      let sql = `
        SELECT id, country, subtype, name, names_json, parent_id, latitude, longitude, source, source_id
        FROM divisions
        WHERE name LIKE ? ESCAPE '\\'
      `;
      const params: unknown[] = [`%${escapedQ}%`];

      if (query.subtype) {
        sql += " AND subtype = ?";
        params.push(query.subtype);
      }

      sql += `
        ORDER BY 
          CASE 
            WHEN LOWER(name) = LOWER(?) THEN 0 
            WHEN LOWER(name) LIKE (LOWER(?) || '%') ESCAPE '\\' THEN 1 
            ELSE 2 
          END, 
          name ASC 
        LIMIT ?
      `;
      params.push(query.q, escapedQ, query.limit);

      const stmt = c.env.REFERENCE_DB.prepare(sql).bind(...params);
      const { results } = await stmt.all<{
        id: string;
        country: string;
        subtype: string;
        name: string;
        names_json: string | null;
        parent_id: string | null;
        latitude: number | null;
        longitude: number | null;
        source: string;
        source_id: string;
      }>();

      const divisions = (results ?? []).map((row) => {
        let parsedNames: Record<string, unknown> | null = null;
        try {
          if (row.names_json) {
            parsedNames = JSON.parse(row.names_json);
          }
        } catch {
          parsedNames = null;
        }

        return {
          id: row.id,
          name: row.name,
          subtype: row.subtype,
          country: row.country,
          parentId: row.parent_id,
          latitude: row.latitude,
          longitude: row.longitude,
          names: parsedNames,
          source: row.source,
          sourceId: row.source_id,
        };
      });

      return c.json({
        data: divisions,
        query: query.q,
        subtype: query.subtype ?? null,
        limit: query.limit,
        count: divisions.length,
      });
    } catch (err) {
      console.error("D1 divisions search failed", err);

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Unable to search divisions.",
            requestId: c.get("requestId"),
          },
        },
        500,
      );
    }
  },
);
