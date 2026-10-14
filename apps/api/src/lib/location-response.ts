import type { LocationResponse } from "@growx-loc/types";

type LocationRow = {
  id: string;
  name: string;
  slug: string;
  location_type: string;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  city: string | null;
  district: string | null;
  state: string;
  pincode: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  metadata: Record<string, unknown> | null;
  distance_km?: number | null;
};

export function toLocationResponse(row: LocationRow): LocationResponse {
  const result: LocationResponse = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.location_type,
    address: {
      line1: row.address_line_1,
      line2: row.address_line_2,
      locality: row.locality,
      city: row.city,
      district: row.district,
      state: row.state,
      pincode: row.pincode,
      countryCode: row.country_code,
    },
    coordinates: {
      lat: row.latitude,
      lng: row.longitude,
    },
    contact: {
      phone: row.phone,
      whatsapp: row.whatsapp,
      email: row.email,
      website: row.website,
    },
    metadata: row.metadata ?? {},
  };

  if (typeof row.distance_km === "number") {
    result.distanceKm = Number(row.distance_km.toFixed(3));
  }

  return result;
}
