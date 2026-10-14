import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const ipRateLimit = createMiddleware<Env>(async (c, next) => {
  if (!c.env.IP_RATE_LIMITER?.limit) {
    return next();
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

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
