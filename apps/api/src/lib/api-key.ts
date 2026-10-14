const GROWX_API_KEY_REGEX = /^gx_loc_[a-f0-9]{64}$/;

export function isGrowxApiKey(value: string): boolean {
  return GROWX_API_KEY_REGEX.test(value);
}

export function getApiKeyPrefix(value: string): string {
  return value.slice(0, Math.min(value.length, 18));
}

export async function hashApiKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);

  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
