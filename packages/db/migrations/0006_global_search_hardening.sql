-- Growx Location
-- 0006_global_search_hardening.sql
--
-- Target: Supabase PostgreSQL (Global DB)
-- Purpose: - Treat user input as literal text in global search (escape LIKE wildcards)
--          - Trigram indexes so substring / autocomplete search does not scan the table
--          - Clear placeholder POINT(0 0) coordinates on divisions with no location

begin;

-- ---------------------------------------------------------------------------
-- 1. TRIGRAM SUPPORT
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;

create index if not exists global_places_name_trgm_idx
  on public.global_places using gin (name extensions.gin_trgm_ops);

create index if not exists global_places_brand_name_trgm_idx
  on public.global_places using gin ((coalesce(brand_name, '')) extensions.gin_trgm_ops);

create index if not exists global_places_locality_trgm_idx
  on public.global_places using gin ((coalesce(locality, '')) extensions.gin_trgm_ops);

create index if not exists global_places_address_trgm_idx
  on public.global_places using gin ((coalesce(address, '')) extensions.gin_trgm_ops);

create index if not exists global_divisions_name_trgm_idx
  on public.global_divisions using gin (name extensions.gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- 2. LIKE ESCAPING HELPER
-- ---------------------------------------------------------------------------

-- Backslash is the default LIKE/ILIKE escape character in PostgreSQL.
create or replace function public.escape_like(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select replace(replace(replace(p_value, '\', '\\'), '%', '\%'), '_', '\_');
$$;

grant execute on function public.escape_like(text)
  to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. SEARCH GLOBAL PLACES (escaped input)
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
    (
      p_category is null
      or p.category ilike public.escape_like(p_category)
      or p.basic_category ilike public.escape_like(p_category)
    )
    and (p_locality is null or coalesce(p.locality, '') ilike '%' || public.escape_like(p_locality) || '%')
    and (p_state is null or coalesce(p.state, '') ilike '%' || public.escape_like(p_state) || '%')
    and (
      p.name ilike '%' || public.escape_like(p_query) || '%'
      or coalesce(p.brand_name, '') ilike '%' || public.escape_like(p_query) || '%'
      or coalesce(p.locality, '') ilike '%' || public.escape_like(p_query) || '%'
      or coalesce(p.address, '') ilike '%' || public.escape_like(p_query) || '%'
    )
  order by
    case
      when lower(p.name) = lower(p_query) then 0
      when p.name ilike public.escape_like(p_query) || '%' then 1
      when lower(coalesce(p.locality, '')) = lower(p_query) then 2
      else 3
    end,
    p.confidence desc nulls last,
    p.name asc
  limit least(greatest(p_limit, 1), 100);
$$;


-- ---------------------------------------------------------------------------
-- 4. NEARBY GLOBAL PLACES (escaped category)
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
      or p.category ilike public.escape_like(p_category)
      or p.basic_category ilike public.escape_like(p_category)
    )
  order by
    p.coordinates::extensions.geography <-> input.point asc
  limit least(greatest(p_limit, 1), 100);
$$;


-- ---------------------------------------------------------------------------
-- 5. SEARCH GLOBAL DIVISIONS (escaped input)
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
    and d.name ilike '%' || public.escape_like(p_query) || '%'
  order by
    case
      when lower(d.name) = lower(p_query) then 0
      when d.name ilike public.escape_like(p_query) || '%' then 1
      else 2
    end,
    d.name asc
  limit least(greatest(p_limit, 1), 100);
$$;


-- ---------------------------------------------------------------------------
-- 6. DIVISION COORDINATE CLEANUP
-- ---------------------------------------------------------------------------

-- Earlier ingests wrote POINT(0 0) when Overture had no bbox for a division.
update public.global_divisions
set coordinates = null
where latitude is null or longitude is null;

commit;
