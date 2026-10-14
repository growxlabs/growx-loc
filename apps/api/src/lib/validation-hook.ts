import type { Hook } from "@hono/zod-validator";

// biome-ignore lint/suspicious/noExplicitAny: generic validation hook for all Zod schemas and routes
export const validationHook: Hook<any, any, any> = (result, c) => {
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
