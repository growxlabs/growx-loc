<USER_REQUEST>
# Growx Location â€” API Hardening, Rate Limits & Error Handling

**File:** `08-api-hardening-rate-limits-errors.md`

## Goal

Harden the Growx Location V1 API before deployment.

This file locks:

```text
request IDs
structured logging
security headers
backend-only CORS policy
pre-auth IP rate limiting
per-API-key rate limiting
request body limits
consistent validation errors
safe 404 handling
safe 500 handling
API versioning
production logging rules
```

No new database or paid third-party service is introduced.

---

# 1. Important Security Decision: V1 Is Backend-to-Backend

Growx Location API keys are secrets.

Therefore, V1 client websites must **not** call:

```text
api.location.growxlabs.tech
```

directly from browser JavaScript with a Growx API key.

That would expose the key to every website visitor.

Correct flow:

```text
Browser
   â†“
Client website backend / server function
   â†“
Growx Location API
   â†“
Supabase/PostGIS
```

For Trionyx:

```text
Trionyx browser
   â†“
Trionyx backend
   â†“
Growx Location API
```

Because of this, V1 does **not** enable permissive CORS on `/v1/*`.

Do not add:

```text
Access-Control-Allow-Origin: *
```

to protected endpoints.

If Growx Location later needs direct browser access, build a separate public-token/scoped endpoint model rather than exposing the existing secret API keys.

---

# 2. Cloudflare Rate-Limit Bindings

Cloudflare Workers has a native Rate Limiting API.

V1 uses two limits:

```text
IP_RATE_LIMITER
â†’ protects authentication/Supabase from obvious request floods

API_RATE_LIMITER
â†’ protects tenant/API-key usage after authentication
```

These limits are abuse protection, not billing/accounting.

Cloudflare rate-limit counters are intentionally permissive/eventually consistent and local to Cloudflare locations, so never use them as exact usage counters.

Use Wrangler `4.36.0` or newer.

Update:

`apps/api/wrangler.jsonc`

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

`namespace_id` must be a positive-integer string and unique for the counter namespace you want.

Keep these two namespace IDs separate.

---

# 3. Binding Types

Update:

`apps/api/src/types/bindings.ts`

```ts
export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;

  IP_RATE_LIMITER: RateLimit;
  API_RATE_LIMITER: RateLimit;
};
```

`RateLimit` is supplied by Cloudflare Workers types.

---

# 4. Add Request Context Fields

Update:

`apps/api/src/types/context.ts`

```ts
export type AuthenticatedTenant = {
  id: string;
  name: string;
  slug: string;
};

export type ApiKeyContext = {
  id: string;
  permissions: string[];
};

export type AppVariables = {
  requestId: string;

  tenant: AuthenticatedTenant;
  apiKey: ApiKeyContext;
};
```

---

# 5. Request ID Middleware

Create:

`apps/api/src/middleware/request-id.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const requestId = createMiddleware<Env>(async (c, next) => {
  const id = crypto.randomUUID();

  c.set("requestId", id);

  await next();

  c.header("X-Request-Id", id);
});
```

Generate the ID on the server.

Do not trust an arbitrary incoming `X-Request-Id` as the canonical request identifier.

---

# 6. Structured Request Logger

Create:

`apps/api/src/middleware/request-logger.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const requestLogger = createMiddleware<Env>(async (c, next) => {
  const startedAt = performance.now();

  await next();

  const durationMs = Math.round(
    (performance.now() - startedAt) * 100,
  ) / 100;

  const tenant = c.get("tenant");
  const apiKey = c.get("apiKey");

  console.log(
    JSON.stringify({
      level: "info",
      event: "http_request",
      requestId: c.get("requestId"),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs,
      tenantId: tenant?.id ?? null,
      apiKeyId: apiKey?.id ?? null,
    }),
  );
});
```

Never log:

```text
Authorization header
raw Growx API key
SUPABASE_SECRET_KEY
request bodies containing client data
full uploaded files
```

---

# 7. Pre-Authentication IP Rate Limit

Create:

`apps/api/src/middleware/ip-rate-limit.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const ipRateLimit = createMiddleware<Env>(async (c, next) => {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    "unknown";

  const result = await c.env.IP_RATE_LIMITER.limit({
    key: `ip:${ip}`,
  });

  if (!result.success) {
    c.header("Retry-After", "60");

    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          requestId: c.get("requestId"),
        },
      },
      429,
    );
  }

  await next();
});
```

Apply this **before** API-key authentication.

This reduces unnecessary Supabase API-key lookups during obvious abuse.

---

# 8. Per-API-Key Rate Limit

Create:

`apps/api/src/middleware/api-rate-limit.ts`

```ts
import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const apiRateLimit = createMiddleware<Env>(async (c, next) => {
  const apiKey = c.get("apiKey");

  const result = await c.env.API_RATE_LIMITER.limit({
    key: `api-key:${apiKey.id}`,
  });

  if (!result.success) {
    c.header("Retry-After", "60");

    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "API rate limit exceeded.",
          requestId: c.get("requestId"),
        },
      },
      429,
    );
  }

  await next();
});
```

Apply this **after** `apiKeyAuth`.

V1 default:

```text
120 requests / minute / source IP
600 requests / minute / authenticated API key
```

These can be changed later without changing route code.

---

# 9. Security Headers

Hono provides built-in secure-header middleware.

Use:

```ts
import { secureHeaders } from "hono/secure-headers";
```

Then:

```ts
app.use("*", secureHeaders());
```

This removes/sets common defensive HTTP headers.

Growx Location is a JSON API, so do not add an HTML-focused Content Security Policy unless a future HTML surface requires one.

---

# 10. CORS Policy

Do **not** add general CORS middleware to `/v1/*` in V1.

Reason:

```text
protected API
+
secret Growx API keys
+
backend-to-backend consumers
```

means browser CORS access is unnecessary and encourages insecure key exposure.

If a browser sends a cross-origin request, it should not receive permissive CORS headers.

A future public browser API must have a separate auth model.

---

# 11. Body Limits

Hono has a built-in `bodyLimit` middleware.

Import:

```ts
import { bodyLimit } from "hono/body-limit";
```

Use small limits for JSON writes.

Create:

`apps/api/src/middleware/body-limits.ts`

```ts
import { bodyLimit } from "hono/body-limit";

export const jsonBodyLimit = bodyLimit({
  maxSize: 64 * 1024,

  onError: (c) => {
    return c.json(
      {
        error: {
          code: "BODY_TOO_LARGE",
          message: "Request body is too large.",
          requestId: c.get("requestId"),
        },
      },
      413,
    );
  },
});

export const importBodyLimit = bodyLimit({
  maxSize: 6 * 1024 * 1024,

  onError: (c) => {
    return c.json(
      {
        error: {
          code: "BODY_TOO_LARGE",
          message: "Import request is too large.",
          requestId: c.get("requestId"),
        },
      },
      413,
    );
  },
});
```

Why 6 MB for imports:

```text
actual file limit = 5 MB
multipart/form-data adds request overhead
```

Keep the explicit 5 MB uploaded-file check from file 6 too.

Apply:

```ts
locations.post("/", jsonBodyLimit, ...);
locations.patch("/:id", jsonBodyLimit, ...);

serviceAreas.post("/", jsonBodyLimit, ...);
serviceAreas.patch("/:id", jsonBodyLimit, ...);

serviceAreaCheck.post("/", jsonBodyLimit, ...);

imports.post("/locations", importBodyLimit, ...);
```

---

# 12. Consistent Validation Errors

Create:

`apps/api/src/lib/validation-hook.ts`

```ts
import type { Hook } from "@hono/zod-validator";
import type { ZodType } from "zod";

export const validationHook: Hook<unknown, ZodType> = (
  result,
  c,
) => {
  if (result.success) {
    return;
  }

  return c.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        requestId: c.get("requestId"),
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    },
    400,
  );
};
```

Then update every `zValidator` call.

Before:

```ts
zValidator("query", nearbyLocationsQuerySchema)
```

After:

```ts
zValidator(
  "query",
  nearbyLocationsQuerySchema,
  validationHook,
)
```

Do the same for:

```text
param
query
json
```

validators across files 5â€“7.

This gives the whole API one validation-error contract.

---

# 13. Error Response Contract

All errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message.",
    "requestId": "uuid"
  }
}
```

Validation errors may additionally contain:

```json
{
  "details": [
    {
      "path": "coordinates.lat",
      "message": "..."
    }
  ]
}
```

Locked V1 error codes:

```text
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
INVALID_LOCATION_TYPE
INVALID_LOCATION
FILE_TOO_LARGE
BODY_TOO_LARGE
UNSUPPORTED_FILE
IMPORT_FAILED
RATE_LIMITED
INTERNAL_ERROR
```

Do not expose:

```text
Postgres SQL
Supabase URL
Supabase error details
stack traces
internal table names
secret values
```

to API consumers.

---

# 14. Global 404

In:

`apps/api/src/index.ts`

after route registration:

```ts
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: c.get("requestId"),
      },
    },
    404,
  );
});
```

V1 deliberately uses `404` for an unmatched route/method rather than building a fragile global `405 Method Not Allowed` registry.

Specific route logic can return `405` later if required.

---

# 15. Global Error Handler

Add:

```ts
app.onError((error, c) => {
  const requestId = c.get("requestId");

  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_error",
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }),
  );

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
        requestId,
      },
    },
    500,
  );
});
```

Never send:

```ts
error.stack
```

or:

```ts
error.message
```

to the client for unhandled errors.

They stay in server-side logs.

---

# 16. Update Existing Auth Errors

Update file 4's `apiKeyAuth` responses so they include:

```ts
requestId: c.get("requestId")
```

Example:

```ts
return c.json(
  {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid API key.",
      requestId: c.get("requestId"),
    },
  },
  401,
);
```

Do the same for:

```text
401
403
429
500
```

responses throughout the API.

---

# 17. Middleware Order

This order matters.

Final `apps/api/src/index.ts` structure:

```ts
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import { apiKeyAuth } from "./middleware/api-key-auth";
import { apiRateLimit } from "./middleware/api-rate-limit";
import { ipRateLimit } from "./middleware/ip-rate-limit";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/request-logger";

import { imports } from "./routes/imports";
import { locations } from "./routes/locations";
import { me } from "./routes/me";
import { nearby } from "./routes/nearby";
import { search } from "./routes/search";
import { serviceAreaCheck } from "./routes/service-area-check";
import { serviceAreas } from "./routes/service-areas";

import type { Bindings } from "./types/bindings";
import type { AppVariables } from "./types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

const app = new Hono<Env>();

// 1. Every request gets an internal correlation ID.
app.use("*", requestId);

// 2. Defensive HTTP headers.
app.use("*", secureHeaders());

// 3. Structured completion logging.
app.use("*", requestLogger);


// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------

app.get("/", (c) => {
  return c.json({
    name: "Growx Location API",
    status: "operational",
    version: "v1",
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "growx-location",
  });
});


// ---------------------------------------------------------------------------
// PROTECTED V1
// ---------------------------------------------------------------------------

// 4. Protect Supabase auth lookup from obvious request floods.
app.use("/v1/*", ipRateLimit);

// 5. Resolve API key â†’ tenant.
app.use("/v1/*", apiKeyAuth);

// 6. Tenant/API-key rate limit.
app.use("/v1/*", apiRateLimit);


// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

app.route("/v1/me", me);

app.route("/v1/locations", locations);
app.route("/v1/search", search);
app.route("/v1/nearby", nearby);

app.route("/v1/imports", imports);

app.route("/v1/service-areas", serviceAreas);
app.route("/v1/service-area/check", serviceAreaCheck);


// ---------------------------------------------------------------------------
// FALLBACKS
// ---------------------------------------------------------------------------

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: c.get("requestId"),
      },
    },
    404,
  );
});

app.onError((error, c) => {
  const requestId = c.get("requestId");

  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_error",
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error",
    }),
  );

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
        requestId,
      },
    },
    500,
  );
});

export default app;
```

---

# 18. Health Endpoint Rule

`/health` must remain cheap.

It should **not** query Supabase on every health request.

Use:

```json
{
  "status": "ok",
  "service": "growx-location"
}
```

for the normal liveness endpoint.

Later, if needed, create a separately protected readiness endpoint that checks dependencies.

Do not turn public health checks into database load.

---

# 19. API Versioning

Keep all product endpoints under:

```text
/v1
```

Examples:

```text
/v1/locations
/v1/search
/v1/nearby
/v1/service-areas
```

Do not create unversioned aliases.

When a breaking API redesign happens later:

```text
/v2
```

can exist beside:

```text
/v1
```

during migration.

---

# 20. Logging Rules

Log:

```text
requestId
HTTP method
path
status
duration
tenantId
apiKeyId
safe internal error message
```

Never log:

```text
raw API key
Authorization header
Supabase secret
full location import contents
personal contact payloads
uploaded file contents
```

Cloudflare Workers Observability can use these `console.log` / `console.error` events.

---

# 21. Rate-Limit Test

Call an authenticated endpoint repeatedly.

Expected after the configured limit:

```text
HTTP 429
Retry-After: 60
```

Response:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "API rate limit exceeded.",
    "requestId": "..."
  }
}
```

Do not build tests that expect the rate limiter to be mathematically exact at the boundary.

Cloudflare's Worker rate limiting is intentionally eventually consistent.

---

# 22. Body-Limit Test

Send a location JSON request larger than 64 KB.

Expected:

```text
HTTP 413
```

For imports:

```text
actual file > 5 MB
â†’ rejected

request body > 6 MB
â†’ rejected by middleware
```

---

# 23. CORS Test

A random browser origin must **not** receive:

```text
Access-Control-Allow-Origin: *
```

from `/v1/*`.

That is correct for V1.

The Growx Location API is not a public browser API.

---

# 24. Production Security Checklist

Before deployment:

- [ ] Wrangler is `4.36.0` or newer
- [ ] `SUPABASE_SECRET_KEY` exists only in Worker secrets / `.dev.vars`
- [ ] `.dev.vars` is ignored by Git
- [ ] no raw Growx API key exists in logs
- [ ] no raw Growx API key exists in PostgreSQL
- [ ] `/v1/*` uses IP rate limiting
- [ ] `/v1/*` uses API-key authentication
- [ ] authenticated calls use per-key rate limiting
- [ ] `/v1/*` has no wildcard CORS
- [ ] JSON write bodies are limited
- [ ] import bodies are limited
- [ ] validation errors have one format
- [ ] unhandled errors return generic `500`
- [ ] error responses contain request IDs
- [ ] server logs contain request IDs
- [ ] health endpoint does not query Supabase
- [ ] every product route remains under `/v1`
- [ ] tenant ID is never accepted as authorization input
- [ ] internal database errors never reach clients

---

# 25. What We Are Not Adding

Do not add these to V1:

```text
Redis
Cloudflare KV for rate limits
Durable Objects for rate limits
third-party API gateway
Sentry
Grafana
custom WAF rules
OAuth
JWT client authentication
public browser API keys
```

They are not necessary to ship this V1.

---

# Next File

`09-production-deployment.md`

That file should cover only the real deployment:

```text
Supabase production project verification
Cloudflare authentication
Worker secrets
rate-limit bindings
Worker deploy
api.location.growxlabs.tech
Cloudflare custom domain
production smoke tests
rollback/check procedure
```

After file 09, file 10 should be the final end-to-end acceptance test and V1 completion checklist.

</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-14T15:18:12+05:30.
</ADDITIONAL_METADATA>
