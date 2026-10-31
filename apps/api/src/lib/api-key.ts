const GROWX_API_KEY_REGEX = /^gx_loc_[a-f0-9]{64}$/;

export function isGrowxApiKey(value: string): boolean {
  return GROWX_API_KEY_REGEX.test(value);
}

export function getApiKeyPrefix(value: string): string {
  return value.slice(0, Math.min(value.length, 18));
}

export type GeneratedApiKey = {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
};

// Same format as scripts/create-api-key.ts: gx_loc_ + 64 hex chars.
export async function generateApiKey(): Promise<GeneratedApiKey> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const encoded = Array.from(random)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const rawKey = `gx_loc_${encoded}`;

  return {
    rawKey,
    keyPrefix: getApiKeyPrefix(rawKey),
    keyHash: await hashApiKey(rawKey),
  };
}

export async function hashApiKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);

  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
