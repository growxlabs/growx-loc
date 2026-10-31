-- Growx Location
-- 0005_global_places_and_divisions.sql
--
-- Target: Supabase PostgreSQL
-- Purpose: Shared global location intelligence layer (India Overture Maps Seed)
--          Strictly decoupled from tenant-specific locations.

begin;

-- ---------------------------------------------------------------------------
-- 1. GLOBAL DIVISIONS (Administrative Hierarchy: Regions/States, Districts, Localities)
-- ---------------------------------------------------------------------------

create table if not exists public.global_divisions (
  id text primary key,

  country text not null default 'IN',
  subtype text not null,

  name text not null,
  names jsonb default '{}'::jsonb,
  hierarchies jsonb default '[]'::jsonb,
  parent_id text,

  latitude double precision,
  longitude double precision,
  coordinates extensions.geometry(Point, 4326),

  source text not null default 'overture',
  source_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint global_divisions_name_not_blank
    check (length(btrim(name)) > 0)
);

drop trigger if exists global_divisions_set_updated_at on public.global_divisions;

create trigger global_divisions_set_updated_at
before update on public.global_divisions
for each row
execute function public.set_updated_at();

create index if not exists global_divisions_subtype_idx
  on public.global_divisions (subtype);

create index if not exists global_divisions_name_idx
  on public.global_divisions (name);

create index if not exists global_divisions_country_subtype_idx
  on public.global_divisions (country, subtype);

create index if not exists global_divisions_coordinates_gix
  on public.global_divisions using gist (coordinates);


-- ---------------------------------------------------------------------------
-- 2. GLOBAL PLACES (Shared POIs: Businesses, Hospitals, Schools, Landmarks, etc.)
-- ---------------------------------------------------------------------------

create table if not exists public.global_places (
  id text primary key,

  name text not null,
  category text not null,
  basic_category text,
  brand_name text,

  confidence numeric(4, 3),

  address text,
  locality text,
  district text,
  state text,
  pincode text,
  country_code text not null default 'IN',

  phone text,
  email text,
  website text,

  latitude double precision not null,
  longitude double precision not null,
  coordinates extensions.geometry(Point, 4326) not null,

  source text not null default 'overture',
  source_id text,

  metadata jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint global_places_name_not_blank
    check (length(btrim(name)) > 0),

  constraint global_places_lat_range
    check (latitude >= -90.0 and latitude <= 90.0),

  constraint global_places_lng_range
    check (longitude >= -180.0 and longitude <= 180.0)
);

drop trigger if exists global_places_set_updated_at on public.global_places;

create trigger global_places_set_updated_at
before update on public.global_places
for each row
execute function public.set_updated_at();

create index if not exists global_places_coordinates_gix
  on public.global_places using gist (coordinates);

create index if not exists global_places_geog_gix
  on public.global_places using gist ((coordinates::extensions.geography));

create index if not exists global_places_category_idx
  on public.global_places (category);

create index if not exists global_places_basic_category_idx
  on public.global_places (basic_category);

create index if not exists global_places_locality_idx
  on public.global_places (locality);

create index if not exists global_places_state_idx
  on public.global_places (state);

create index if not exists global_places_name_idx
  on public.global_places (name);

create index if not exists global_places_country_code_idx
  on public.global_places (country_code);


-- ---------------------------------------------------------------------------
-- 3. SEARCH GLOBAL PLACES FUNCTION
-- ---------------------------------------------------------------------------

create or replace function public.search_global_places(
  p_query text,
  p_category text default null,
  p_locality text default null,
  p_state text default null,
  p_limit integer default 25
)
returns table (
  id text,
  name text,
  category text,
  basic_category text,
  brand_name text,
  confidence numeric(4, 3),
  address text,
  locality text,
  district text,
  state text,
  pincode text,
  country_code text,
  latitude double precision,
  longitude double precision,
  phone text,
  website text,
  source text,
  source_id text
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  select
    p.id,
    p.name,
    p.category,
    p.basic_category,
    p.brand_name,
    p.confidence,
    p.address,
    p.locality,
    p.district,
    p.state,
    p.pincode,
    p.country_code,
    p.latitude,
    p.longitude,
    p.phone,
    p.website,
    p.source,
    p.source_id
  from public.global_places p
  where
    (p_category is null or p.category ilike p_category or p.basic_category ilike p_category)
    and (p_locality is null or coalesce(p.locality, '') ilike '%' || p_locality || '%')
    and (p_state is null or coalesce(p.state, '') ilike '%' || p_state || '%')
    and (
      p.name ilike '%' || p_query || '%'
      or coalesce(p.brand_name, '') ilike '%' || p_query || '%'
      or coalesce(p.locality, '') ilike '%' || p_query || '%'
      or coalesce(p.address, '') ilike '%' || p_query || '%'
    )
  order by
    case
      when lower(p.name) = lower(p_query) then 0
      when lower(p.name) like lower(p_query) || '%' then 1
      when lower(coalesce(p.locality, '')) = lower(p_query) then 2
      else 3
    end,
    p.confidence desc nulls last,
    p.name asc
  limit least(greatest(p_limit, 1), 100);
$$;


-- ---------------------------------------------------------------------------
-- 4. NEARBY GLOBAL PLACES FUNCTION (Spatial PostGIS Great-Circle Distance)
-- ---------------------------------------------------------------------------

create or replace function public.nearby_global_places(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 25,
  p_category text default null,
  p_limit integer default 25
)
returns table (
  id text,
  name text,
  category text,
  basic_category text,
  brand_name text,
  confidence numeric(4, 3),
  address text,
  locality text,
  district text,
  state text,
  pincode text,
  country_code text,
  latitude double precision,
  longitude double precision,
  phone text,
  website text,
  source text,
  source_id text,
  distance_km double precision
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with input as (
    select
      extensions.st_setsrid(
        extensions.st_makepoint(p_lng, p_lat),
        4326
      )::extensions.geography as point
  )
  select
    p.id,
    p.name,
    p.category,
    p.basic_category,
    p.brand_name,
    p.confidence,
    p.address,
    p.locality,
    p.district,
    p.state,
    p.pincode,
    p.country_code,
    p.latitude,
    p.longitude,
    p.phone,
    p.website,
    p.source,
    p.source_id,
    round(
      (extensions.st_distance(p.coordinates::extensions.geography, input.point) / 1000.0)::numeric,
      2
    )::double precision as distance_km
  from public.global_places p
  cross join input
  where
    extensions.st_dwithin(
      p.coordinates::extensions.geography,
      input.point,
      p_radius_km * 1000.0
    )
    and (
      p_category is null
      or p.category ilike p_category
      or p.basic_category ilike p_category
    )
  order by
    p.coordinates::extensions.geography <-> input.point asc
  limit least(greatest(p_limit, 1), 100);
$$;


-- ---------------------------------------------------------------------------
-- 5. SEARCH GLOBAL DIVISIONS FUNCTION
-- ---------------------------------------------------------------------------

create or replace function public.search_global_divisions(
  p_query text,
  p_subtype text default null,
  p_limit integer default 25
)
returns table (
  id text,
  name text,
  subtype text,
  country text,
  parent_id text,
  latitude double precision,
  longitude double precision,
  source text,
  source_id text
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  select
    d.id,
    d.name,
    d.subtype,
    d.country,
    d.parent_id,
    d.latitude,
    d.longitude,
    d.source,
    d.source_id
  from public.global_divisions d
  where
    (p_subtype is null or d.subtype = p_subtype)
    and (
      d.name ilike '%' || p_query || '%'
    )
  order by
    case
      when lower(d.name) = lower(p_query) then 0
      when lower(d.name) like lower(p_query) || '%' then 1
      else 2
    end,
    d.name asc
  limit least(greatest(p_limit, 1), 100);
$$;


-- ---------------------------------------------------------------------------
-- 6. SECURITY & GRANTS
-- ---------------------------------------------------------------------------

alter table public.global_divisions enable row level security;
alter table public.global_places enable row level security;

-- Read-only policy for public/authenticated/service_role
drop policy if exists "Global divisions are viewable by everyone" on public.global_divisions;

create policy "Global divisions are viewable by everyone"
  on public.global_divisions for select
  using (true);

drop policy if exists "Global places are viewable by everyone" on public.global_places;

create policy "Global places are viewable by everyone"
  on public.global_places for select
  using (true);

grant select on public.global_divisions to anon, authenticated, service_role;
grant select on public.global_places to anon, authenticated, service_role;

grant all on public.global_divisions to service_role;
grant all on public.global_places to service_role;

grant execute on function public.search_global_places(text, text, text, text, integer)
  to anon, authenticated, service_role;

grant execute on function public.nearby_global_places(double precision, double precision, double precision, text, integer)
  to anon, authenticated, service_role;

grant execute on function public.search_global_divisions(text, text, integer)
  to anon, authenticated, service_role;

commit;
