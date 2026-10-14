# Growx Location — V1 End-to-End Acceptance

**File:** `10-v1-end-to-end-acceptance.md`

## Goal

Verify that the entire Growx Location V1 works correctly from authentication through production deployment.

This is the final architecture/acceptance file.

After this passes:

```text
stop architecture work
stop adding scope
ship the V1
integrate clients/products
```

---

# 1. Final V1 Scope

Growx Location V1 must support:

```text
API-key authentication
tenant isolation
location CRUD
location types
search
nearby search
distance
service areas
radius coverage
pincode coverage
CSV/JSON imports
Supabase Storage imports
rate limiting
request IDs
structured logs
production deployment
custom API domain
```

It does not need:

```text
Google Maps
Google Places
Pelias
Elasticsearch
Valhalla
public browser API keys
frontend/admin panel
polygon API
traffic
turn-by-turn routing
worldwide POI search
```

---

# 2. Final Stack

```text
Repository
growx-loc

Monorepo
Turborepo

Package Manager
Bun

Language
TypeScript

API Framework
Hono

Runtime
Cloudflare Workers

Database
Supabase PostgreSQL

Geo
PostGIS

Storage
Supabase Storage

Production Domain
api.location.growxlabs.tech
```

---

# 3. Pre-Test Requirements

Before acceptance testing:

- [ ] files 02–09 are implemented
- [ ] all database migrations are applied
- [ ] PostGIS exists in `extensions`
- [ ] production Worker is deployed
- [ ] custom domain is active
- [ ] test tenant exists
- [ ] valid API key exists
- [ ] revoked API key exists for negative tests
- [ ] location type `office` exists
- [ ] location type `distributor` exists
- [ ] API key has all required V1 permissions

Recommended test permissions:

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

# 4. Environment Variables for Testing

Set locally:

```bash
export BASE_URL="https://api.location.growxlabs.tech"
export API_KEY="gx_loc_REPLACE"
```

PowerShell:

```powershell
$env:BASE_URL="https://api.location.growxlabs.tech"
$env:API_KEY="gx_loc_REPLACE"
```

Never commit these values.

---

# 5. Test 1 — Health

Request:

```bash
curl "$BASE_URL/health"
```

Expected:

```text
HTTP 200
```

Body:

```json
{
  "status": "ok",
  "service": "growx-location"
}
```

Pass conditions:

- [ ] returns 200
- [ ] no API key required
- [ ] no database details returned
- [ ] no secrets returned

---

# 6. Test 2 — Missing API Key

Request:

```bash
curl "$BASE_URL/v1/me"
```

Expected:

```text
HTTP 401
```

Pass conditions:

- [ ] returns `UNAUTHORIZED`
- [ ] contains `requestId`
- [ ] no internal error details exposed

---

# 7. Test 3 — Invalid API Key

```bash
curl \
  -H "Authorization: Bearer gx_loc_invalid" \
  "$BASE_URL/v1/me"
```

Expected:

```text
401
```

Pass conditions:

- [ ] invalid key rejected
- [ ] Supabase secret not exposed
- [ ] raw SQL/database errors not exposed

---

# 8. Test 4 — Valid API Key

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/me"
```

Expected:

```text
200
```

Body should contain:

```text
tenant
apiKey
permissions
```

Pass:

- [ ] correct tenant resolved
- [ ] correct API key ID returned
- [ ] raw API key is not returned

---

# 9. Test 5 — Create Location

Request:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acceptance Distributor",
    "slug": "acceptance-distributor",
    "locationType": "distributor",
    "address": {
      "line1": "Test Road",
      "city": "Vijayawada",
      "district": "NTR",
      "state": "Andhra Pradesh",
      "pincode": "520010",
      "countryCode": "IN"
    },
    "coordinates": {
      "lat": 16.5062,
      "lng": 80.6480
    },
    "contact": {
      "phone": "+919999999999"
    },
    "metadata": {
      "acceptanceTest": true
    }
  }' \
  "$BASE_URL/v1/locations"
```

Expected:

```text
201
```

Save returned:

```text
LOCATION_ID
```

Pass:

- [ ] location created
- [ ] location belongs to authenticated tenant
- [ ] type = distributor
- [ ] coordinates correct
- [ ] metadata correct
- [ ] `geo_point` populated automatically

---

# 10. Test 6 — Duplicate Slug

Repeat same create request.

Expected:

```text
409
```

Pass:

- [ ] duplicate prevented
- [ ] returns `CONFLICT`

---

# 11. Test 7 — List Locations

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/locations"
```

Expected:

```text
200
```

Pass:

- [ ] acceptance location appears
- [ ] only active tenant locations returned
- [ ] no other tenant data appears

---

# 12. Test 8 — Get One Location

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/locations/$LOCATION_ID"
```

Expected:

```text
200
```

Pass:

- [ ] correct location returned
- [ ] response matches stable response contract

---

# 13. Test 9 — Search

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/search?q=Acceptance"
```

Expected:

```text
200
```

Pass:

- [ ] acceptance location returned

Then:

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/search?q=Vijayawada"
```

Pass:

- [ ] city-based search returns expected tenant locations

---

# 14. Test 10 — Nearby Search

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/nearby?lat=16.5150&lng=80.6600&radius=5"
```

Expected:

```text
200
```

Pass:

- [ ] acceptance location returned
- [ ] `distanceKm` present
- [ ] distance is positive
- [ ] results nearest-first

---

# 15. Test 11 — Radius Service Area

Create:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Acceptance Radius\",
    \"type\": \"radius\",
    \"locationId\": \"$LOCATION_ID\",
    \"radiusKm\": 25
  }" \
  "$BASE_URL/v1/service-areas"
```

Expected:

```text
201
```

Save:

```text
RADIUS_AREA_ID
```

---

# 16. Test 12 — Radius Coverage

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "coordinates": {
      "lat": 16.5150,
      "lng": 80.6600
    }
  }' \
  "$BASE_URL/v1/service-area/check"
```

Pass:

- [ ] `covered = true`
- [ ] radius area returned
- [ ] distance present

---

# 17. Test 13 — Out-of-Range Radius Coverage

Use clearly distant coordinates.

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "coordinates": {
      "lat": 17.3850,
      "lng": 78.4867
    }
  }' \
  "$BASE_URL/v1/service-area/check"
```

Expected:

```text
covered = false
```

Pass:

- [ ] no false-positive radius match

---

# 18. Test 14 — Pincode Service Area

Create:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acceptance Pincodes",
    "type": "pincode_list",
    "pincodes": [
      "520010",
      "520001"
    ]
  }' \
  "$BASE_URL/v1/service-areas"
```

Expected:

```text
201
```

---

# 19. Test 15 — Pincode Coverage

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pincode": "520010"
  }' \
  "$BASE_URL/v1/service-area/check"
```

Expected:

```text
covered = true
```

Then test:

```text
999999
```

Expected:

```text
covered = false
```

---

# 20. Test 16 — Update Location

```bash
curl \
  -X PATCH \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contact": {
      "phone": "+918888888888"
    },
    "coordinates": {
      "lat": 16.5070,
      "lng": 80.6490
    }
  }' \
  "$BASE_URL/v1/locations/$LOCATION_ID"
```

Expected:

```text
200
```

Pass:

- [ ] phone updated
- [ ] coordinates updated
- [ ] PostGIS point updated automatically
- [ ] nearby search reflects new coordinates

---

# 21. Test 17 — CSV Import

Create:

`acceptance-locations.csv`

```csv
name,slug,location_type,city,state,country_code,latitude,longitude,status
Acceptance Import One,acceptance-import-one,distributor,Vijayawada,Andhra Pradesh,IN,16.5100,80.6500,active
Acceptance Import Two,acceptance-import-two,distributor,Guntur,Andhra Pradesh,IN,16.3067,80.4365,active
```

Upload:

```bash
curl \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@acceptance-locations.csv" \
  "$BASE_URL/v1/imports/locations"
```

Expected:

```text
201
```

Pass:

- [ ] status completed
- [ ] totalRows = 2
- [ ] insertedRows = 2
- [ ] failedRows = 0
- [ ] Storage file exists in tenant-scoped path

---

# 22. Test 18 — Import Upsert

Change one imported row while keeping same slug.

Re-upload.

Expected:

```text
updatedRows >= 1
```

Pass:

- [ ] duplicate row not created
- [ ] same tenant + same slug updates existing record

---

# 23. Test 19 — Bad Import Row

Add invalid coordinates:

```text
lat = 999
```

Expected:

- [ ] row rejected
- [ ] failedRows increments
- [ ] other valid rows still process
- [ ] raw internal error not exposed

---

# 24. Test 20 — Soft Delete

```bash
curl \
  -X DELETE \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/locations/$LOCATION_ID"
```

Expected:

```text
204
```

Then:

```bash
curl \
  -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/v1/locations/$LOCATION_ID"
```

Expected:

```text
404
```

Pass:

- [ ] record still exists in database
- [ ] status = inactive
- [ ] normal read API hides it

---

# 25. Test 21 — Revoked Key

Set test API key:

```text
status = revoked
```

Call:

```bash
curl \
  -H "Authorization: Bearer REVOKED_KEY" \
  "$BASE_URL/v1/me"
```

Expected:

```text
401
```

Pass:

- [ ] revoked key rejected immediately

---

# 26. Test 22 — Expired Key

Set:

```text
expires_at < current time
```

Expected:

```text
401
```

Pass:

- [ ] expired key rejected

---

# 27. Test 23 — Missing Permission

Use key without:

```text
locations:write
```

Call:

```text
POST /v1/locations
```

Expected:

```text
403
```

Pass:

- [ ] permission enforcement works

---

# 28. Test 24 — Cross-Tenant Isolation

Create:

```text
Tenant A
Tenant B
```

Create one location under Tenant A.

Using Tenant B API key:

```bash
GET /v1/locations/TENANT_A_LOCATION_ID
```

Expected:

```text
404
```

Using Tenant B key:

```text
PATCH Tenant A location
```

Expected:

```text
404
```

Using Tenant B key:

```text
DELETE Tenant A location
```

Expected:

```text
404
```

Pass:

- [ ] Tenant B cannot read Tenant A
- [ ] Tenant B cannot modify Tenant A
- [ ] Tenant B cannot delete Tenant A
- [ ] no response leaks existence of foreign record

This is a critical acceptance test.

---

# 29. Test 25 — Cross-Tenant Service Area Reference

Using Tenant B key, attempt to create radius service area with:

```text
Tenant A location ID
```

Expected:

```text
400 INVALID_LOCATION
```

Pass:

- [ ] foreign location cannot be attached

---

# 30. Test 26 — Validation

Examples:

```text
latitude = 200
invalid UUID
empty search query
radius = -5
bad email
bad URL
```

Expected:

```text
400 VALIDATION_ERROR
```

Pass:

- [ ] response contains requestId
- [ ] validation details are safe and understandable

---

# 31. Test 27 — Request Body Limits

Send oversized JSON.

Expected:

```text
413 BODY_TOO_LARGE
```

Upload file above 5 MB.

Expected:

```text
413
```

Pass:

- [ ] oversized requests rejected before expensive processing

---

# 32. Test 28 — Rate Limiting

Send repeated requests.

Expected eventually:

```text
429 RATE_LIMITED
```

Pass:

- [ ] Retry-After present
- [ ] requestId present
- [ ] API remains healthy

Do not assert the exact mathematical threshold.

---

# 33. Test 29 — Security Headers

Inspect:

```bash
curl -I "$BASE_URL/health"
```

Pass:

- [ ] Hono security headers present
- [ ] no unnecessary server internals exposed

---

# 34. Test 30 — CORS

From random browser origin, protected `/v1/*` response should not expose:

```text
Access-Control-Allow-Origin: *
```

Pass:

- [ ] API remains backend-to-backend
- [ ] secret API keys are not intended for browser use

---

# 35. Test 31 — Request IDs

Call any endpoint.

Pass:

- [ ] response contains `X-Request-Id`
- [ ] error body contains same request ID where applicable
- [ ] Cloudflare logs contain corresponding request ID

---

# 36. Test 32 — Structured Logs

Verify Worker logs include:

```text
requestId
method
path
status
durationMs
tenantId
apiKeyId
```

Verify logs do not include:

```text
Authorization
raw API key
Supabase secret
full import contents
```

---

# 37. Test 33 — Production Domain

All acceptance tests must finally run against:

```text
https://api.location.growxlabs.tech
```

not only:

```text
workers.dev
localhost
```

Pass:

- [ ] custom domain resolves
- [ ] TLS valid
- [ ] health works
- [ ] authenticated routes work

---

# 38. Test 34 — Database Integrity

Run:

```sql
select
  count(*) as bad_geo_points
from public.locations
where
  latitude is not null
  and longitude is not null
  and geo_point is null;
```

Expected:

```text
0
```

Run:

```sql
select
  tenant_id,
  slug,
  count(*)
from public.locations
group by tenant_id, slug
having count(*) > 1;
```

Expected:

```text
0 rows
```

---

# 39. Test 35 — Storage Isolation

Verify import objects follow:

```text
<tenant-id>/<import-id>/<filename>
```

Pass:

- [ ] no public bucket
- [ ] no cross-tenant unscoped paths
- [ ] raw Storage URLs not exposed by API

---

# 40. Final Acceptance Matrix

| Capability | Must Pass |
|---|---|
| Health | ✅ |
| API-key auth | ✅ |
| Tenant resolution | ✅ |
| Permissions | ✅ |
| Create location | ✅ |
| Read location | ✅ |
| Search | ✅ |
| Nearby | ✅ |
| Distance | ✅ |
| Update location | ✅ |
| Soft delete | ✅ |
| Radius coverage | ✅ |
| Pincode coverage | ✅ |
| CSV import | ✅ |
| JSON import | ✅ |
| Import upsert | ✅ |
| Storage isolation | ✅ |
| Cross-tenant isolation | ✅ |
| Validation | ✅ |
| Body limits | ✅ |
| Rate limiting | ✅ |
| Request IDs | ✅ |
| Structured logs | ✅ |
| Production domain | ✅ |

Every critical row must pass before calling V1 complete.

---

# 41. V1 Completion Definition

Growx Location V1 is complete when:

```text
A GrowxLabs/client backend can:

authenticate
→ store its locations
→ retrieve them
→ search them
→ find nearby locations
→ check service coverage
→ import batches
→ update/deactivate locations

without seeing another tenant's data.
```

That is the product.

Do not delay launch for features outside this definition.

---

# 42. After V1

Only add features based on real client need.

Potential future work:

```text
public city/pincode reference datasets
address geocoding
public POI datasets
polygon service areas
routing
SDK package
admin UI
usage analytics
key management UI
background import queues
```

Do not build these automatically.

---

# 43. First Real Integration

The first real client integration should be simple.

For Trionyx:

```text
Trionyx backend
   ↓
GET /v1/locations?type=distributor
   ↓
Growx Location
   ↓
return distributor locations
```

Then frontend displays:

```text
Vijayawada
Andhra Pradesh

1 city

[ Enquire ]
```

Growx Location should stay invisible infrastructure behind the product.

---

# 44. Final Decision

Once all critical acceptance tests pass:

```text
V1 = DONE
```

No more architecture documents.

Next work becomes:

```text
implementation fixes
client integration
real location data
production usage
```
