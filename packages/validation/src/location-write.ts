import { z } from "zod";

const optionalText = z.string().trim().max(500).nullable().optional();

const locationStatusSchema = z.enum(["active", "inactive", "draft"]);

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(200),

  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(200)
    .optional(),

  locationType: z.string().trim().min(1).max(80),

  address: z.object({
    line1: optionalText,
    line2: optionalText,
    locality: optionalText,
    city: optionalText,
    district: optionalText,
    state: z.string().trim().min(1).max(120),
    pincode: z.string().trim().max(20).nullable().optional(),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .default("IN"),
  }),

  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),

  contact: z
    .object({
      phone: optionalText,
      whatsapp: optionalText,
      email: z.string().email().nullable().optional(),
      website: z.string().url().nullable().optional(),
    })
    .default({}),

  metadata: z.record(z.string(), z.unknown()).default({}),

  status: locationStatusSchema.default("active"),
});

export const updateLocationSchema = createLocationSchema
  .partial()
  .extend({
    address: createLocationSchema.shape.address.partial().optional(),
    coordinates: createLocationSchema.shape.coordinates.partial().optional(),
    contact: createLocationSchema.shape.contact.unwrap().partial().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided.",
  );

export const importIdParamSchema = z.object({
  id: z.string().uuid(),
});
