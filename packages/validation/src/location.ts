import { z } from "zod";

export const locationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listLocationsQuerySchema = z.object({
  type: z.string().trim().min(1).max(80).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  state: z.string().trim().min(1).max(120).optional(),
  pincode: z.string().trim().min(1).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const searchLocationsQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  type: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const nearbyLocationsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(200).default(25),
  type: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
