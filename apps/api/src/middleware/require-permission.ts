import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export function requirePermission(permission: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const apiKey = c.get("apiKey");

    if (!apiKey.permissions.includes(permission)) {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "API key does not have the required permission.",
            requestId: c.get("requestId"),
          },
        },
        403,
      );
    }

    await next();
  };
}
