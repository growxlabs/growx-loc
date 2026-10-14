# Growx Location — Worker ↔ Supabase + API-Key Auth Foundation

**File:** `04-worker-supabase-api-key-auth.md`

## Goal

Connect the Cloudflare Worker to Supabase securely and add the authentication foundation that every Growx Location endpoint will use.

After completing this file:

- the Worker can connect to Supabase,
- Supabase secrets stay server-side,
- Growx API keys are hashed before lookup,
- a valid API key resolves exactly one tenant,
- revoked/expired keys are rejected,
- authenticated tenant context is available to routes,
- no location/search endpoint has to implement authentication again.

---

## Important 2026 Supabase Key Decision

Use the newer Supabase **secret key** (`sb_secret_...`) for the Worker.
Do **not** use the legacy project `service_role` API key for new setup.

Environment variable:
```text
SUPABASE_SECRET_KEY
```

---

## Security Rules Locked Here

1. Raw Growx API keys never enter PostgreSQL.
2. API-key hashes are stored in `api_keys.key_hash`.
3. Supabase secret key exists only in Cloudflare Worker secrets / local `.dev.vars`.
4. Supabase secret key is never returned by any route.
5. Client-provided `tenant_id` is never trusted.
6. Tenant identity comes from the API key record.
7. Every future location query filters by `tenant.id`.
8. Revoked keys return `401`.
9. Expired keys return `401`.
10. Suspended/archived tenants return `403`.
11. API permissions are checked before protected route logic.
12. Never log raw authorization headers or raw API keys.
