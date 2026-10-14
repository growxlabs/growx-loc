import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const apiRateLimit = createMiddleware<Env>(async (c, next) => {
  if (!c.env.API_RATE_LIMITER?.limit) {
    return next();
  }

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
