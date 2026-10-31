import { createMiddleware } from "hono/factory";
import type { Bindings } from "../types/bindings";
import type { AppVariables } from "../types/context";

type Env = {
  Bindings: Bindings;
  Variables: AppVariables;
};

const MIN_SECRET_LENGTH = 32;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

// Hash both sides first so the comparison is constant-time and length-independent.
async function secretsMatch(
  provided: string,
  expected: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);

  // Both digests are 32 bytes; XOR-accumulate so timing does not depend on where they differ.
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

export const adminAuth = createMiddleware<Env>(async (c, next) => {
  const expected = c.env.ADMIN_API_SECRET?.trim();

  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return c.json(
      {
        error: {
          code: "ADMIN_DISABLED",
          message: "Admin API is not configured.",
          requestId: c.get("requestId"),
        },
      },
      503,
    );
  }

  const authorization = c.req.header("Authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!provided || !(await secretsMatch(provided, expected))) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid admin credentials.",
          requestId: c.get("requestId"),
        },
      },
      401,
    );
  }

  const actorId = c.req.header("X-Admin-Actor-Id")?.trim() ?? "";
  const actorEmail = c.req.header("X-Admin-Actor-Email")?.trim() ?? "";

  if (
    actorId.length === 0 ||
    actorId.length > 200 ||
    actorEmail.length > 320 ||
    !EMAIL_REGEX.test(actorEmail)
  ) {
    return c.json(
      {
        error: {
          code: "ADMIN_ACTOR_REQUIRED",
          message:
            "X-Admin-Actor-Id and a valid X-Admin-Actor-Email are required.",
          requestId: c.get("requestId"),
        },
      },
      400,
    );
  }

  c.set("adminActor", { id: actorId, email: actorEmail });

  await next();
});
