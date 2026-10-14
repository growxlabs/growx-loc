begin;

-- ---------------------------------------------------------------------------
-- IMPORT JOBS
-- ---------------------------------------------------------------------------

create table public.location_imports (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null
    references public.tenants(id)
    on delete cascade,

  file_name text not null,
  storage_path text not null,

  file_format text not null
    check (file_format in ('csv', 'json')),

  status text not null default 'uploaded'
    check (
      status in (
        'uploaded',
        'processing',
        'completed',
        'failed'
      )
    ),

  total_rows integer not null default 0
    check (total_rows >= 0),

  inserted_rows integer not null default 0
    check (inserted_rows >= 0),

  updated_rows integer not null default 0
    check (updated_rows >= 0),

  failed_rows integer not null default 0
    check (failed_rows >= 0),

  error_summary jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint location_imports_file_name_not_blank
    check (length(btrim(file_name)) > 0),

  constraint location_imports_storage_path_not_blank
    check (length(btrim(storage_path)) > 0),

  constraint location_imports_error_summary_is_array
    check (jsonb_typeof(error_summary) = 'array')
);

create index location_imports_tenant_id_idx
  on public.location_imports (tenant_id);

create index location_imports_tenant_created_at_idx
  on public.location_imports (tenant_id, created_at desc);

create trigger location_imports_set_updated_at
before update on public.location_imports
for each row
execute function public.set_updated_at();

alter table public.location_imports enable row level security;

revoke all on table public.location_imports
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.location_imports
  to service_role;


-- ---------------------------------------------------------------------------
-- PRIVATE SUPABASE STORAGE BUCKET
-- ---------------------------------------------------------------------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'location-imports',
  'location-imports',
  false,
  5242880,
  array[
    'text/csv',
    'application/csv',
    'application/json'
  ]::text[]
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table public.location_imports is
  'Tenant-scoped audit records for CSV/JSON location bulk imports.';

commit;
