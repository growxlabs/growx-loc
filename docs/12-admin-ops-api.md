# Growx Location — Admin / Ops API

**File:** `12-admin-ops-api.md`

## Goal

Give the GrowxLabs ops team a safe way to run Growx Location without SQL or scripts:

- create and manage tenants (clients),
- issue, revoke and rotate tenant API keys,
- see per-tenant and per-key usage,
- keep an audit trail of every ops action.

Growx Location stays **headless**. This file adds API endpoints only. The ops UI lives in the existing
GrowxLabs admin (`growxlabs.tech/admin`, repo `grow-x`) as a new **Location** section that calls this API
server-side.

Out of scope for this batch:

- linking tenants to grow-x CRM clients (next batch),
- client self-service (client portal),
- publishable browser keys.

---

# 1. Architecture

```text
Staff browser
    │  NextAuth session (ADMIN / CO_ADMIN only)
    ▼
grow-x  /admin/location/*            ← UI pages
    │
grow-x  /api/admin/location/*        ← Next.js route handlers, role check on the server
    │  HTTPS, server-side only
    │  Authorization: Bearer <GROWX_LOC_ADMIN_SECRET>
    │  X-Admin-Actor-Id / X-Admin-Actor-Email
    ▼
api.location.growxlabs.tech/admin/v1/*   ← this file
    │  Supabase secret key (Worker only)
    ▼
Supabase DB1 (core): tenants, api_keys, api_key_usage_daily, admin_audit_logs
```

Rules:

- The admin secret exists only in the Worker and in grow-x server env (Vercel). Never in a browser bundle.
- grow-x never connects to the Growx Location database. All ops go through this API.
- Tenant API keys (`gx_loc_…`) can never call `/admin/*`, and the admin secret can never call `/v1/*`.
- Raw tenant API keys are returned **once**, at creation or rotation, and never stored.
- **No delete endpoints.** Tenants are suspended or archived; keys are revoked. Nothing is hard-deleted.

---

# 2. Authentication

```http
Authorization: Bearer <ADMIN_API_SECRET>
X-Admin-Actor-Id: <grow-x staff user id>
X-Admin-Actor-Email: <grow-x staff email>
```

- `ADMIN_API_SECRET` is a Worker secret, at least 32 characters.
- Compared in constant time (SHA-256 of both values, then `crypto.subtle.timingSafeEqual`).
- Both actor headers are required on every admin request. They are recorded in the audit log.
  They identify *who* acted; the secret proves the caller is grow-x.
- `/admin/*` is behind the same pre-auth IP rate limit as `/v1/*`.
- If `ADMIN_API_SECRET` is not configured, every admin request is rejected (`503 ADMIN_DISABLED`).

Errors:

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | missing or wrong secret |
| 400 | `ADMIN_ACTOR_REQUIRED` | actor headers missing or invalid |
| 503 | `ADMIN_DISABLED` | secret not configured on the Worker |

---

# 3. Endpoints

All responses use the existing `{ data }` / `{ error: { code, message, requestId } }` shapes.

### Overview

```text
GET /admin/v1/overview
```

Tenant counts by status, active key count, requests today and in the last 30 days.

### Tenants

```text
GET   /admin/v1/tenants?status=&q=&limit=&offset=
POST  /admin/v1/tenants                    { name, slug? }
GET   /admin/v1/tenants/:tenantId
PATCH /admin/v1/tenants/:tenantId          { name?, status? }   status: active | suspended | archived
```

- `slug` defaults to a slug of `name`. Duplicate slug → `409 SLUG_TAKEN`.
- Suspending or archiving a tenant blocks all of its keys immediately (existing `/v1` auth already checks
  tenant status).

### API keys

```text
GET  /admin/v1/tenants/:tenantId/keys
POST /admin/v1/tenants/:tenantId/keys      { name, permissions[], expiresAt? }
POST /admin/v1/keys/:keyId/revoke
POST /admin/v1/keys/:keyId/rotate          { graceHours? }   0–168, default 24
```

- Key listings never include `key_hash`. They show `keyPrefix`, name, permissions, status, expiry and
  `lastUsedAt`.
- Create and rotate return `{ data: { key, rawKey } }`. `rawKey` is shown once; the UI must tell staff to
  copy it now.
- **Rotate** creates a new key with the same name, permissions and expiry, then sets the old key's `expiresAt` to
  `now + graceHours` (never later than its existing expiry). `graceHours = 0` revokes the old key at once.
  Clients swap keys during the grace window with no downtime.
- Allowed permissions: `locations:read`, `locations:write`, `imports:read`, `imports:write`,
  `service-areas:read`, `service-areas:write`.

### Usage

```text
GET /admin/v1/tenants/:tenantId/usage?days=30&keyId=
```

Daily request counts per key for the last `days` (1–90), plus totals.

### Audit log

```text
GET /admin/v1/audit-logs?tenantId=&limit=&before=
```

Newest first. `before` is an ISO timestamp cursor for paging.

---

# 4. Data model (migration `0008_admin_ops.sql`, DB1)

### `api_key_usage_daily`

| Column | Type |
|---|---|
| `api_key_id` | uuid → `api_keys.id` |
| `tenant_id` | uuid → `tenants.id` |
| `usage_date` | date (UTC) |
| `request_count` | bigint |

Primary key `(api_key_id, usage_date)`.

Written by `public.record_api_key_usage(p_api_key_id, p_tenant_id)`, which upserts today's counter and sets
`api_keys.last_used_at`. The Worker calls it after successful `/v1` authentication with
`executionCtx.waitUntil`, so it never adds latency or fails a client request.

One small write per request is fine for V1 volumes. At high volume, move counting to Cloudflare Analytics
Engine and keep this table as a daily rollup.

### `admin_audit_logs`

| Column | Type |
|---|---|
| `id` | uuid |
| `actor_id`, `actor_email` | text, from the actor headers |
| `action` | text, e.g. `tenant.create`, `api_key.rotate` |
| `tenant_id` | uuid, nullable |
| `target_type`, `target_id` | text |
| `metadata` | jsonb (never raw keys or hashes) |
| `request_id` | text |
| `created_at` | timestamptz |

### Functions

- `record_api_key_usage(p_api_key_id, p_tenant_id)` — usage counter, see above.
- `rotate_api_key(p_old_key_id, p_key_prefix, p_key_hash, p_grace_hours)` — inserts the new key and expires
  or revokes the old one in **one transaction**, so a rotation can never half-complete.
- `admin_overview()` — counts for `GET /admin/v1/overview`.

Both tables and all three functions: RLS enabled, all access revoked from `anon` / `authenticated`,
`service_role` only — the same rules as the other core tables.

Audit actions:

```text
tenant.create   tenant.update
api_key.create  api_key.revoke  api_key.rotate
```

---

# 5. grow-x integration (Location section)

Follows the existing grow-x admin module pattern (`requireXAdmin()` + `supabaseAdmin` style helpers).

```text
app/admin/location/page.tsx                 overview + tenant list
app/admin/location/[tenantId]/page.tsx      tenant detail: status, keys, usage, audit
app/api/admin/location/[...path]/route.ts   server-side proxy to /admin/v1/*
lib/location/server.ts                      requireLocationAdmin(), growxLocAdminFetch()
lib/admin-nav.ts                            add "Location" module
```

- `requireLocationAdmin()` uses `getServerSession(authOptions)` and allows only `ADMIN` and `CO_ADMIN`.
  `crm_agent`, `IDENTITY_USER` and `CLIENT` are rejected on the server.
- The proxy forwards only allow-listed paths and methods, attaches the admin secret and the actor headers
  from the session, and never forwards the browser's cookies or headers.
- grow-x env (Vercel, server-only):

```text
GROWX_LOC_ADMIN_URL=https://api.location.growxlabs.tech
GROWX_LOC_ADMIN_SECRET=<same value as the Worker's ADMIN_API_SECRET>
```

---

# 6. Deployment checklist

1. Apply `packages/db/migrations/0008_admin_ops.sql` to DB1.
2. Generate a secret and set it on the Worker:

   ```bash
   wrangler secret put ADMIN_API_SECRET
   ```

3. Deploy the Worker (`bun run deploy:api`).
4. Set `GROWX_LOC_ADMIN_URL` and `GROWX_LOC_ADMIN_SECRET` in grow-x (Vercel) and deploy grow-x.
5. Smoke test: create a test tenant, create a key, call `/v1/me` with it, check usage, rotate, revoke,
   archive the tenant.

---

# 7. Acceptance criteria

- Wrong or missing admin secret → 401; tenant API key on `/admin/*` → 401.
- Admin secret on `/v1/*` → 401.
- Created and rotated keys work on `/v1/me` immediately; `rawKey` never appears in any later response.
- Rotated old key works until `expiresAt`, then returns `API key expired`.
- Revoked key and keys of suspended/archived tenants are rejected on `/v1`.
- Every mutating admin call writes one `admin_audit_logs` row with the actor.
- Usage counts increase after `/v1` calls.
- No admin endpoint deletes data.
