import type { ServiceAreaResponse } from "@growx-loc/types";

type ServiceAreaRow = {
  id: string;
  name: string;
  area_type: "radius" | "pincode_list";
  location_id: string | null;
  radius_km: number | string | null;
  pincodes: string[] | null;
  metadata: Record<string, unknown> | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
};

export function toServiceAreaResponse(
  row: ServiceAreaRow,
): ServiceAreaResponse {
  return {
    id: row.id,
    name: row.name,
    type: row.area_type,
    locationId: row.location_id,
    radiusKm: row.radius_km === null ? null : Number(row.radius_km),
    pincodes: row.pincodes,
    metadata: row.metadata ?? {},
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
