import { z } from "zod";

export const API_KEY_PERMISSIONS = [
  "locations:read",
  "locations:write",
  "imports:read",
  "imports:write",
  "service-areas:read",
  "service-areas:write",
] as const;

export const TENANT_STATUSES = ["active", "suspended", "archived"] as const;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens.",
  );

export const adminTenantIdParamSchema = z.object({
  tenantId: z.string().uuid(),
});

export const adminKeyIdParamSchema = z.object({
  keyId: z.string().uuid(),
});

export const adminTenantListQuerySchema = z.object({
  status: z.enum(TENANT_STATUSES).optional(),
  // Restricted characters: the value is embedded in a PostgREST filter expression.
  q: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      /^[\p{L}\p{N} .&'-]+$/u,
      "Use letters, numbers, spaces and . & ' - only.",
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const adminCreateTenantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
});

export const adminUpdateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(TENANT_STATUSES).optional(),
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: "Provide at least one field to update.",
  });

export const adminCreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(200),
  permissions: z
    .array(z.enum(API_KEY_PERMISSIONS))
    .min(1)
    .transform((permissions) => [...new Set(permissions)]),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: "expiresAt must be in the future.",
    })
    .optional(),
});

export const adminRotateApiKeySchema = z.object({
  graceHours: z.number().int().min(0).max(168).default(24),
});

export const adminUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  keyId: z.string().uuid().optional(),
});

export const adminAuditLogQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});
