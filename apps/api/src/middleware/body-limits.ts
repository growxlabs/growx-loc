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
