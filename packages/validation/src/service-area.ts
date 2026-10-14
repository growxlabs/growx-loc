import { z } from "zod";

const radiusAreaSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.literal("radius"),
  locationId: z.string().uuid(),
  radiusKm: z.number().positive().max(500),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const pincodeAreaSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.literal("pincode_list"),
  locationId: z.string().uuid().nullable().optional(),
  pincodes: z.array(z.string().trim().min(1).max(20)).min(1).max(500),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createServiceAreaSchema = z.discriminatedUnion("type", [
  radiusAreaSchema,
  pincodeAreaSchema,
]);

export const serviceAreaIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateServiceAreaSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    radiusKm: z.number().positive().max(500).optional(),
    pincodes: z
      .array(z.string().trim().min(1).max(20))
      .min(1)
      .max(500)
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided.",
  );

export const checkServiceAreaSchema = z
  .object({
    coordinates: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional(),

    pincode: z.string().trim().min(1).max(20).optional(),
  })
  .refine(
    (value) => Boolean(value.coordinates || value.pincode),
    "Coordinates or pincode is required.",
  );
