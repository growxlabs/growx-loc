-- Growx Location
-- 0008_admin_ops.sql
--
-- Target: Supabase PostgreSQL (DB1 / core)
-- Purpose: Tables for the admin / ops API (docs/12-admin-ops-api.md):
--          - api_key_usage_daily: per-key daily request counters
--          - admin_audit_logs:    who did what through /admin/v1
-- Re-runnable.

begin;

-- ---------------------------------------------------------------------------
-- 1. API KEY USAGE (daily counters)
-- ---------------------------------------------------------------------------

create table if not exists public.api_key_usage_daily (
  api_key_id uuid not null
    references public.api_keys(id)
    on delete cascade,

  tenant_id uuid not null
    references public.tenants(id)
    on delete cascade,

  usage_date date not null,
  request_count bigint not null default 0,

  primary key (api_key_id, usage_date),

  constraint api_key_usage_daily_count_non_negative
    check (request_count >= 0)
);

create index if not exists api_key_usage_daily_tenant_date_idx
  on public.api_key_usage_daily (tenant_id, usage_date desc);

create index if not exists api_key_usage_daily_date_idx
  on public.api_key_usage_daily (usage_date desc);

create or replace function public.record_api_key_usage(
  p_api_key_id uuid,
  p_tenant_id uuid
)
returns void
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  insert into public.api_key_usage_daily as u (api_key_id, tenant_id, usage_date, request_count)
  values (p_api_key_id, p_tenant_id, (now() at time zone 'utc')::date, 1)
  on conflict (api_key_id, usage_date)
  do update set request_count = u.request_count + 1;

  update public.api_keys
  set last_used_at = now()
  where id = p_api_key_id;
$$;


-- ---------------------------------------------------------------------------
-- 2. ADMIN AUDIT LOGS
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),

  actor_id text not null,
  actor_email text not null,

  action text not null,

  tenant_id uuid
    references public.tenants(id)
    on delete set null,

  target_type text not null,
  target_id text,

  metadata jsonb not null default '{}'::jsonb,
  request_id text,

  created_at timestamptz not null default now(),

  constraint admin_audit_logs_action_not_blank
    check (length(btrim(action)) > 0),

  constraint admin_audit_logs_metadata_is_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_tenant_created_at_idx
  on public.admin_audit_logs (tenant_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 3. ATOMIC KEY ROTATION
-- ---------------------------------------------------------------------------

-- Creates the replacement key and schedules the old key's expiry in one transaction,
-- so a failure can never leave a new raw key issued without the old key being handled.
create or replace function public.rotate_api_key(
  p_old_key_id uuid,
  p_key_prefix text,
  p_key_hash text,
  p_grace_hours integer
)
returns setof public.api_keys
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_old public.api_keys;
  v_new public.api_keys;
begin
  select * into v_old
  from public.api_keys
  where id = p_old_key_id
  for update;

  if not found then
    raise exception 'API_KEY_NOT_FOUND';
  end if;

  if v_old.status <> 'active' or (v_old.expires_at is not null and v_old.expires_at <= now()) then
    raise exception 'API_KEY_NOT_ACTIVE';
  end if;

  insert into public.api_keys (tenant_id, name, key_prefix, key_hash, permissions, status, expires_at)
  values (v_old.tenant_id, v_old.name, p_key_prefix, p_key_hash, v_old.permissions, 'active', v_old.expires_at)
  returning * into v_new;

  if p_grace_hours <= 0 then
    update public.api_keys
    set status = 'revoked'
    where id = v_old.id;
  else
    update public.api_keys
    set expires_at = least(
      coalesce(v_old.expires_at, 'infinity'::timestamptz),
      now() + make_interval(hours => p_grace_hours)
    )
    where id = v_old.id;
  end if;

  return next v_new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. ADMIN OVERVIEW
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'tenants', jsonb_build_object(
      'active', (select count(*) from public.tenants where status = 'active'),
      'suspended', (select count(*) from public.tenants where status = 'suspended'),
      'archived', (select count(*) from public.tenants where status = 'archived')
    ),
    'activeApiKeys', (
      select count(*)
      from public.api_keys
      where status = 'active' and (expires_at is null or expires_at > now())
    ),
    'requestsToday', (
      select coalesce(sum(request_count), 0)
      from public.api_key_usage_daily
      where usage_date = (now() at time zone 'utc')::date
    ),
    'requestsLast30Days', (
      select coalesce(sum(request_count), 0)
      from public.api_key_usage_daily
      where usage_date > (now() at time zone 'utc')::date - 30
    )
  );
$$;


-- ---------------------------------------------------------------------------
-- 5. SECURITY & GRANTS (service_role only, like the other core tables)
-- ---------------------------------------------------------------------------

alter table public.api_key_usage_daily enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.api_key_usage_daily from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;

grant select, insert, update, delete
  on table public.api_key_usage_daily
  to service_role;

-- Audit rows are append-only for the backend.
-- Explicit revoke: Supabase default privileges grant ALL on new public tables to service_role.
revoke update, delete, truncate
  on table public.admin_audit_logs
  from service_role;

grant select, insert
  on table public.admin_audit_logs
  to service_role;

revoke all on function public.record_api_key_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_api_key_usage(uuid, uuid) to service_role;

revoke all on function public.rotate_api_key(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.rotate_api_key(uuid, text, text, integer) to service_role;

revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to service_role;

comment on table public.api_key_usage_daily is
  'Per API key daily request counters, written by the Worker after successful /v1 authentication.';

comment on table public.admin_audit_logs is
  'Append-only audit trail of ops actions made through /admin/v1.';

commit;
