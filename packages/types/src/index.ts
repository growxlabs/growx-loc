export type TenantStatus = "active" | "suspended" | "archived";
export type ApiKeyStatus = "active" | "revoked";
export type LocationStatus = "active" | "inactive" | "draft";
export type ServiceAreaType = "radius" | "pincode_list" | "polygon";
export type ServiceAreaStatus = "active" | "inactive";
export type LocationSourceType =
  | "client"
  | "csv"
  | "api"
  | "manual"
  | "growx"
  | "public_dataset";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permissions: string[];
  status: ApiKeyStatus;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocationType {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  tenant_id: string;
  location_type_id: string;
  name: string;
  slug: string;
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
  geo_point?: unknown;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  metadata: Record<string, unknown>;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
}

export interface ServiceArea {
  id: string;
  tenant_id: string;
  location_id: string | null;
  name: string;
  area_type: ServiceAreaType;
  radius_km: number | null;
  pincodes: string[] | null;
  geometry: unknown | null;
  metadata: Record<string, unknown>;
  status: ServiceAreaStatus;
  created_at: string;
  updated_at: string;
}

export interface LocationSource {
  id: string;
  tenant_id: string;
  location_id: string;
  source_type: LocationSourceType;
  source_reference: string | null;
  imported_at: string;
  verified_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NearbyLocation extends Location {
  distance_meters: number;
}

export interface SearchResult {
  locations: Location[];
  total: number;
}

export * from "./location";
export * from "./service-area";
