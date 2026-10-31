export type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;

  SUPABASE_GLOBAL_URL: string;
  SUPABASE_GLOBAL_KEY: string;

  // Shared secret for /admin/v1 (grow-x server only). Admin API is disabled when unset.
  ADMIN_API_SECRET?: string;

  REFERENCE_DB: D1Database;

  IP_RATE_LIMITER: RateLimit;
  API_RATE_LIMITER: RateLimit;
};
