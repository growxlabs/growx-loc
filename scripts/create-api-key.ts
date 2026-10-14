const random = crypto.getRandomValues(new Uint8Array(32));

const encoded = Array.from(random)
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const rawKey = `gx_loc_${encoded}`;

const digest = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode(rawKey),
);

const keyHash = Array.from(new Uint8Array(digest))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

console.log(
  JSON.stringify(
    {
      rawKey,
      keyPrefix: rawKey.slice(0, 18),
      keyHash,
    },
    null,
    2,
  ),
);
