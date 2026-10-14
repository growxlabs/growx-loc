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

// 5. Resolve API key → tenant.
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
  const reqId = c.get("requestId");

  console.error(
    JSON.stringify({
      level: "error",
      event: "unhandled_error",
      requestId: reqId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
        requestId: reqId,
      },
    },
    500,
  );
});

export default app;
