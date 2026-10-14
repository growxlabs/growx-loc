# Growx Location — Database Architecture (V1)

## Purpose

This document locks the V1 database architecture before implementation.

Growx Location is a backend-only, multi-tenant location service used by GrowxLabs products and client applications.

## Locked Stack

- **API**: Cloudflare Workers + Hono
- **Language**: TypeScript
- **Package manager**: Bun
- **Monorepo**: Turborepo
- **Database**: Supabase PostgreSQL
- **Geo engine**: PostGIS
- **File storage**: Supabase Storage
- **Frontend**: None for Growx Location V1

---

## Core Data Model

### `tenants`
Represents each client or GrowxLabs product.

Fields:
- `id` — UUID, primary key
- `name` — text
- `slug` — text, unique
- `status` — active / suspended / archived
- `created_at` — timestamptz
- `updated_at` — timestamptz

Every client-owned record must reference a tenant.

---

### `api_keys`
Controls access to the Growx Location API.

Fields:
- `id` — UUID, primary key
- `tenant_id` — FK → `tenants.id`
- `name` — human-readable key name
- `key_prefix` — visible prefix for identification
- `key_hash` — securely hashed API key
- `permissions` — JSONB
- `status` — active / revoked
- `expires_at` — nullable timestamptz
- `last_used_at` — nullable timestamptz
- `created_at` — timestamptz

Rules:
- Never store raw API keys.
- Never accept `tenant_id` from the client as proof of identity.
- Tenant identity is resolved from the authenticated API key.

---

### `location_types`
Allows each tenant to define its own location categories.

Fields:
- `id` — UUID, primary key
- `tenant_id` — FK → `tenants.id`
- `name` — text
- `slug` — text
- `created_at` — timestamptz

Examples:
- distributor, dealer, warehouse, branch, service-centre, office, pickup-point

Unique constraint:
- `(tenant_id, slug)`

---

### `locations`
Main physical-location table.

Fields:
- `id` — UUID, primary key
- `tenant_id` — FK → `tenants.id`
- `location_type_id` — FK → `location_types.id`
- `name` — text
- `slug` — text
- `address_line_1` — text
- `address_line_2` — nullable text
- `locality` — nullable text
- `city` — text
- `district` — nullable text
- `state` — text
- `pincode` — nullable text
- `country_code` — text, default 'IN'
- `latitude` — double precision
- `longitude` — double precision
- `geo_point` — geography(Point, 4326)
- `phone` — nullable text
- `whatsapp` — nullable text
- `email` — nullable text
- `website` — nullable text
- `metadata` — JSONB
- `status` — active / inactive / draft
- `created_at` — timestamptz
- `updated_at` — timestamptz

Important:
- `latitude`/`longitude` are convenient API fields.
- `geo_point` is the actual PostGIS field used for geo queries.
- `metadata` stores client-specific fields without expanding the table endlessly.

Indexes:
- GIST index on `geo_point`
- B-tree index on `tenant_id`
- B-tree index on `location_type_id`
- B-tree index on `city`
- B-tree index on `state`
- B-tree index on `pincode`
- Composite indexes where tenant filtering is common

---

### `service_areas`
Defines where a location can serve customers.

Fields:
- `id` — UUID, primary key
- `tenant_id` — FK → `tenants.id`
- `location_id` — nullable FK → `locations.id`
- `name` — text
- `area_type` — radius / polygon / pincode_list
- `radius_km` — nullable numeric
- `geometry` — nullable geography/geometry
- `pincodes` — nullable text[]
- `metadata` — JSONB
- `status` — active / inactive
- `created_at` — timestamptz
- `updated_at` — timestamptz

V1 supports:
1. Radius from a location
2. Pincode list

---

### `location_sources`
Tracks where location data came from.

Fields:
- `id` — UUID, primary key
- `location_id` — FK → `locations.id`
- `source_type` — client / csv / api / manual / public_dataset
- `source_reference` — nullable text
- `imported_at` — timestamptz
- `verified_at` — nullable timestamptz
- `metadata` — JSONB

---

## PostGIS Geo Engine

Primary geographic type:
```sql
geography(Point, 4326)
```

Proximity query pattern:
```sql
ST_DWithin(
  geo_point,
  ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
  :radius_meters
)
```

Distance calculation pattern:
```sql
ST_Distance(
  geo_point,
  ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
)
```

---

## Multi-Tenant Security & RLS

- Row Level Security (RLS) is enabled on all tenant-owned tables (`api_keys`, `location_types`, `locations`, `service_areas`, `location_sources`).
- Application-level tenant enforcement in Cloudflare Workers using authenticated API key identity is mandatory.

---

## Supabase Storage

- Private bucket: `location-imports` (for bulk CSV, GeoJSON imports).
