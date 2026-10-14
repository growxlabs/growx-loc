import { Hono } from "hono";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export const me = new Hono<Env>();

me.get("/", (c) => {
  return c.json({
    data: {
      tenant: c.get("tenant"),
      apiKey: c.get("apiKey"),
    },
  });
});
