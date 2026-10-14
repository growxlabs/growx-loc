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
