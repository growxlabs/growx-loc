# Growx Location — Production Deployment

**File:** `09-production-deployment.md`

## Goal

Deploy Growx Location V1 to production using:

```text
Cloudflare Workers
Supabase PostgreSQL + PostGIS
Supabase Storage
api.location.growxlabs.tech
```

This file assumes files 1–8 are already implemented and passing locally.

---

# 1. Production Architecture

```text
Client backend / GrowxLabs product
            ↓
https://api.location.growxlabs.tech
            ↓
Cloudflare Worker
            ↓
Supabase
├── PostgreSQL + PostGIS
└── Storage
```

No VPS.

No Fastify.

No frontend deployment for Growx Location itself.

---

# 2. Production Supabase Project

Use a dedicated Supabase project for Growx Location.

Do not share the database with the GrowxLabs marketing website.

Production project must contain:

```text
PostgreSQL
PostGIS
location-imports Storage bucket
```

Run migrations in order:

```text
02-initial-database-migration.sql
03-seed-and-geo-tests.sql
0002_read_api_functions.sql
0003_write_api_and_imports.sql
0004_service_area_api.sql
```

The seed file is acceptable for verification, but remove test records afterward if they are not wanted in production.

---

# 3. Verify PostGIS

Run in Supabase SQL editor:

```sql
select
  e.extname,
  n.nspname as schema_name
from pg_extension e
join pg_namespace n
  on n.oid = e.extnamespace
where e.extname = 'postgis';
```

Expected:

```text
postgis | extensions
```

If PostGIS is not in `extensions`, stop deployment and correct the database setup first.

---

# 4. Verify Required Tables

Run:

```sql
select tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'tenants',
    'api_keys',
    'location_types',
    'locations',
    'service_areas',
    'location_sources',
    'location_imports'
  )
order by tablename;
```

Expected: all seven tables.

---

# 5. Verify RLS

Run:

```sql
select
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'tenants',
    'api_keys',
    'location_types',
    'locations',
    'service_areas',
    'location_sources',
    'location_imports'
  )
order by tablename;
```

Expected:

```text
rowsecurity = true
```

for every row.

---

# 6. Verify Storage Bucket

Check:

```sql
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'location-imports';
```

Expected:

```text
public = false
```

and approximately:

```text
5 MB limit
CSV + JSON MIME types
```

---

# 7. Production Supabase Credentials

Get:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Use the current Supabase secret key format:

```text
sb_secret_...
```

Never use this secret in:

```text
frontend code
Git
README
client applications
public environment variables
logs
```

It belongs only in Cloudflare Worker secrets.

---

# 8. Cloudflare Authentication

From the repository root:

```bash
bunx wrangler login
```

Verify:

```bash
bunx wrangler whoami
```

Make sure you are logged into the correct Cloudflare account containing:

```text
growxlabs.tech
```

---

# 9. Verify Wrangler Config

`apps/api/wrangler.jsonc` should contain:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",

  "name": "growx-location-api",

  "main": "src/index.ts",

  "compatibility_date": "2026-10-14",

  "secrets": {
    "required": [
      "SUPABASE_URL",
      "SUPABASE_SECRET_KEY"
    ]
  },

  "ratelimits": [
    {
      "name": "IP_RATE_LIMITER",
      "namespace_id": "1001",
      "simple": {
        "limit": 120,
        "period": 60
      }
    },
    {
      "name": "API_RATE_LIMITER",
      "namespace_id": "1002",
      "simple": {
        "limit": 600,
        "period": 60
      }
    }
  ],

  "observability": {
    "enabled": true
  }
}
```

Do not place real secret values here.

---

# 10. Install + Verify Locally

From repo root:

```bash
bun install
```

Then:

```bash
bun run typecheck
```

Then:

```bash
bun run lint
```

Then:

```bash
bun run build
```

All must pass before deployment.

---

# 11. Set Production Worker Secrets

From:

```text
apps/api
```

run:

```bash
bunx wrangler secret put SUPABASE_URL
```

Paste the production project URL.

Then:

```bash
bunx wrangler secret put SUPABASE_SECRET_KEY
```

Paste the production Supabase secret key.

Verify secret names:

```bash
bunx wrangler secret list
```

Expected names:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Do not expect Wrangler to show secret values.

---

# 12. Deploy Worker

From:

```text
apps/api
```

run:

```bash
bunx wrangler deploy
```

Wrangler should return the deployed Worker URL.

Example shape:

```text
https://growx-location-api.<workers-subdomain>.workers.dev
```

Keep this URL temporarily for smoke testing.

---

# 13. First Smoke Test on workers.dev

Test:

```bash
curl https://YOUR_WORKER.workers.dev/health
```

Expected:

```json
{
  "status": "ok",
  "service": "growx-location"
}
```

Then:

```bash
curl https://YOUR_WORKER.workers.dev/v1/me
```

Expected:

```text
401
```

That proves the protected routes are actually protected.

---

# 14. Create Production Growx API Key

Use the local API-key generation script from file 4.

Run:

```bash
bun scripts/create-api-key.ts
```

Store:

```text
rawKey
keyPrefix
keyHash
```

Only insert:

```text
keyPrefix
keyHash
```

into Supabase.

Never insert the raw key.

Give the production development/test API key only the permissions needed:

```json
[
  "locations:read",
  "locations:write",
  "imports:read",
  "imports:write",
  "service-areas:read",
  "service-areas:write"
]
```

---

# 15. Test Authenticated Production Route

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  https://YOUR_WORKER.workers.dev/v1/me
```

Expected:

```json
{
  "data": {
    "tenant": {
      "name": "GrowxLabs",
      "slug": "growxlabs"
    }
  }
}
```

---

# 16. Configure Custom Domain

Production domain:

```text
api.location.growxlabs.tech
```

Preferred approach:

```text
Cloudflare Worker Custom Domain
```

Do not manually expose an origin server.

In Cloudflare:

```text
Workers & Pages
→ growx-location-api
→ Settings
→ Domains & Routes
→ Add
→ Custom Domain
```

Set:

```text
api.location.growxlabs.tech
```

Because `growxlabs.tech` is already managed by Cloudflare DNS, Cloudflare can attach the Worker directly to that hostname.

---

# 17. Verify Custom Domain

After the custom domain becomes active:

```bash
curl https://api.location.growxlabs.tech/health
```

Expected:

```json
{
  "status": "ok",
  "service": "growx-location"
}
```

Then:

```bash
curl https://api.location.growxlabs.tech/v1/me
```

Expected:

```text
401
```

Then authenticated:

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  https://api.location.growxlabs.tech/v1/me
```

Expected:

```text
200
```

---

# 18. Production Location Smoke Test

List:

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "https://api.location.growxlabs.tech/v1/locations"
```

Search:

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "https://api.location.growxlabs.tech/v1/search?q=Vijayawada"
```

Nearby:

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "https://api.location.growxlabs.tech/v1/nearby?lat=16.515&lng=80.660&radius=5"
```

These must work before any client integration begins.

---

# 19. Service Area Smoke Test

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "coordinates": {
      "lat": 16.515,
      "lng": 80.66
    }
  }' \
  https://api.location.growxlabs.tech/v1/service-area/check
```

Expected:

```text
200
```

with:

```json
{
  "data": {
    "covered": true
  }
}
```

if test coverage exists.

---

# 20. Import Smoke Test

Use a tiny CSV.

Example:

`test-locations.csv`

```csv
name,slug,location_type,city,state,country_code,latitude,longitude,status
Production Test,production-test,office,Vijayawada,Andhra Pradesh,IN,16.5062,80.6480,active
```

Run:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@test-locations.csv" \
  https://api.location.growxlabs.tech/v1/imports/locations
```

Expected:

```text
201
```

Then verify the uploaded file exists in:

```text
Supabase Storage
→ location-imports
→ <tenant-id>/<import-id>/
```

---

# 21. Verify Observability

Cloudflare Worker logs should contain structured request events.

Look for:

```text
event = http_request
requestId
method
path
status
durationMs
tenantId
apiKeyId
```

Confirm logs do not contain:

```text
Authorization headers
raw API keys
Supabase secret
full uploaded data
```

---

# 22. Verify Rate Limiting

Send repeated calls.

Expected eventually:

```text
429
```

with:

```text
Retry-After: 60
```

Do not treat the exact request boundary as billing-grade accounting.

Cloudflare Worker rate limiting is abuse protection.

---

# 23. Production Environment Separation

Do not use one Supabase project for both:

```text
development
production
```

Recommended:

```text
Growx Location Dev
Growx Location Production
```

Likewise:

```text
.dev.vars
→ development credentials

Cloudflare Worker secrets
→ production credentials
```

Never copy production secrets into local files unless absolutely necessary.

---

# 24. Deployment Script

Add to:

`apps/api/package.json`

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src"
  }
}
```

Then deployment is simply:

```bash
bun run deploy
```

from `apps/api`.

---

# 25. Root Deployment Convenience

Optional root script:

```json
{
  "scripts": {
    "deploy:api": "bun --cwd apps/api run deploy"
  }
}
```

Then:

```bash
bun run deploy:api
```

---

# 26. Rollback Strategy

Cloudflare Workers supports deployment/version history.

If a production deployment breaks:

```text
do not start editing DNS
do not rotate Supabase secrets
do not recreate the Worker
```

First rollback the Worker deployment/version.

Then diagnose locally.

Database rollback is different.

For database migrations:

```text
never delete production tables casually
never edit historical migration files after they ran
```

Instead create a new corrective migration.

Example:

```text
0005_fix_service_area_constraint.sql
```

Do not rewrite:

```text
0004_service_area_api.sql
```

after production has already applied it.

---

# 27. Database Backup Rule

Before any future destructive migration:

```text
verify Supabase backup availability
export critical data if needed
```

V1 migrations should be additive whenever possible.

Avoid:

```text
DROP TABLE
DROP COLUMN
```

unless there is a reviewed migration plan.

---

# 28. Secret Rotation

If:

```text
SUPABASE_SECRET_KEY
```

is exposed:

1. revoke/rotate it in Supabase,
2. update the Worker secret,
3. redeploy if necessary,
4. inspect logs and repository history,
5. remove leaked values from Git history if committed.

If a Growx API key is exposed:

1. set its database status to:

```text
revoked
```

2. create a new Growx API key,
3. update only the affected client.

Do not rotate every client's key because one key leaked.

---

# 29. DNS / Domain Rule

Production consumers should use only:

```text
https://api.location.growxlabs.tech
```

Do not give clients the:

```text
workers.dev
```

URL.

That hostname is only useful for initial deployment testing.

The custom API hostname gives GrowxLabs control over future infrastructure changes.

---

# 30. Client Integration Rule

Do not give clients:

```text
Supabase credentials
database credentials
Storage credentials
Worker secrets
```

They receive only:

```text
Growx Location API base URL
Growx Location API key
API documentation
```

Example:

```text
Base URL:
https://api.location.growxlabs.tech

Authorization:
Bearer gx_loc_...
```

---

# 31. Production Go-Live Checklist

Do not call the service production-ready until all pass:

- [ ] production Supabase project exists
- [ ] PostGIS is installed in `extensions`
- [ ] all migrations are applied
- [ ] RLS enabled on tenant tables
- [ ] Storage bucket is private
- [ ] Worker secrets are configured
- [ ] secret values are absent from Git
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] Worker deploy succeeds
- [ ] workers.dev health check passes
- [ ] workers.dev protected route returns `401`
- [ ] authenticated workers.dev request succeeds
- [ ] `api.location.growxlabs.tech` is attached
- [ ] custom-domain health check passes
- [ ] custom-domain auth works
- [ ] locations list works
- [ ] search works
- [ ] nearby works
- [ ] service-area check works
- [ ] CSV import works
- [ ] request IDs appear in responses
- [ ] structured logs appear in Cloudflare
- [ ] no secrets appear in logs
- [ ] rate limiting returns `429`
- [ ] clients use only the custom domain
- [ ] rollback procedure is understood

---

# 32. Final Production Stack

```text
Repository
growx-loc
Turborepo + Bun

        ↓

Cloudflare Workers
Hono + TypeScript
api.location.growxlabs.tech

        ↓

Supabase Production
PostgreSQL + PostGIS
Private Storage
```

This is the complete V1 production deployment architecture.

---

# Next File

`10-v1-end-to-end-acceptance.md`

That is the final file before implementation is considered complete.

It should verify the entire flow:

```text
API key
→ tenant
→ create location
→ read location
→ search
→ nearby
→ service-area coverage
→ update
→ import
→ soft delete
→ cross-tenant isolation
→ security failures
→ production domain
```

Once file 10 passes, stop architecture work and ship/integrate the service.
