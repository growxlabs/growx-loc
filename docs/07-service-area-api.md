# Growx Location — V1 Service Area API

**File:** `07-service-area-api.md`

## Goal

Add tenant-safe service-area management and coverage checks.

V1 supports:
- `radius`
- `pincode_list`

Endpoints:
```text
POST   /v1/service-areas
GET    /v1/service-areas
GET    /v1/service-areas/:id
PATCH  /v1/service-areas/:id
DELETE /v1/service-areas/:id

POST   /v1/service-area/check
```

---

## Permissions

- `service-areas:read`
- `service-areas:write`

---

## Service Area Types

### Radius Areas
- Must have `locationId` and `radiusKm`.
- Coverage computed using PostGIS `ST_DWithin` on the location's `geo_point`.

### Pincode Areas
- Must have a list of valid `pincodes`.
- Coverage matches customer's postal code via array membership (`any(sa.pincodes)`), supported by a GIN index on `pincodes`.
