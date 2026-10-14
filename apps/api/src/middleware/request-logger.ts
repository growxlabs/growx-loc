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

  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;

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
