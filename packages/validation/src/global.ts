import { z } from "zod";

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const globalNearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(200),
  category: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const divisionsSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  subtype: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
