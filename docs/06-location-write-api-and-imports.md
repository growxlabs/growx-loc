# Growx Location — V1 Write API + Bulk Imports

**File:** `06-location-write-api-and-imports.md`

## Goal

Add the first write capabilities to Growx Location:

```text
POST   /v1/locations
PATCH  /v1/locations/:id
DELETE /v1/locations/:id

POST   /v1/imports/locations
GET    /v1/imports/:id
```

This file keeps the V1 rules already locked:
- backend-only,
- API-key authentication,
- tenant identity comes from the API key,
- PostgreSQL/PostGIS is the source of truth,
- Supabase Storage is used only for uploaded import files,
- deleting a location is a soft-delete (`status = 'inactive'`),
- all writes are tenant-scoped.

---

## Permission Model

- `locations:read`
- `locations:write`
- `imports:read`
- `imports:write`

---

## Import Rules

- Max file size: 5 MB
- Supported formats: `.csv`, `.json`
- Storage path: `<tenant_id>/<import_id>/<filename>` in private bucket `location-imports`
- Upsert rule: `tenant_id + slug` identifies existing records for updates.
