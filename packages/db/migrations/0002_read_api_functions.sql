begin;

-- ---------------------------------------------------------------------------
-- SEARCH
-- ---------------------------------------------------------------------------

create or replace function public.search_locations(
  p_tenant_id uuid,
  p_query text,
  p_type text default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  name text,
  slug text,
  location_type text,
  address_line_1 text,
  address_line_2 text,
  locality text,
  city text,
  district text,
  state text,
  pincode text,
  country_code char(2),
  latitude double precision,
  longitude double precision,
  phone text,
  whatsapp text,
  email text,
  website text,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  select
    l.id,
    l.name,
    l.slug,
    lt.slug as location_type,
    l.address_line_1,
    l.address_line_2,
    l.locality,
    l.city,
    l.district,
    l.state,
    l.pincode,
    l.country_code,
    l.latitude,
    l.longitude,
    l.phone,
    l.whatsapp,
    l.email,
    l.website,
    l.metadata
  from public.locations l
  join public.location_types lt
    on lt.id = l.location_type_id
   and lt.tenant_id = l.tenant_id
  where l.tenant_id = p_tenant_id
    and l.status = 'active'
    and (
      p_type is null
      or lt.slug = p_type
    )
    and (
      l.name ilike '%' || p_query || '%'
      or coalesce(l.locality, '') ilike '%' || p_query || '%'
      or coalesce(l.city, '') ilike '%' || p_query || '%'
      or coalesce(l.district, '') ilike '%' || p_query || '%'
      or l.state ilike '%' || p_query || '%'
      or coalesce(l.pincode, '') ilike '%' || p_query || '%'
    )
  order by
    case
      when lower(l.name) = lower(p_query) then 0
      when lower(coalesce(l.city, '')) = lower(p_query) then 1
      when lower(l.name) like lower(p_query) || '%' then 2
      else 3
    end,
    l.name asc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.search_locations(uuid, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.search_locations(uuid, text, text, integer)
  to service_role;


-- ---------------------------------------------------------------------------
-- NEARBY
-- ---------------------------------------------------------------------------

create or replace function public.nearby_locations(
  p_tenant_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 25,
  p_type text default null,
  p_limit integer default 25
)
returns table (
  id uuid,
  name text,
  slug text,
  location_type text,
  address_line_1 text,
  address_line_2 text,
  locality text,
  city text,
  district text,
  state text,
  pincode text,
  country_code char(2),
  latitude double precision,
  longitude double precision,
  phone text,
  whatsapp text,
  email text,
  website text,
  metadata jsonb,
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
    l.id,
    l.name,
    l.slug,
    lt.slug as location_type,
    l.address_line_1,
    l.address_line_2,
    l.locality,
    l.city,
    l.district,
    l.state,
    l.pincode,
    l.country_code,
    l.latitude,
    l.longitude,
    l.phone,
    l.whatsapp,
    l.email,
    l.website,
    l.metadata,
    (
      extensions.st_distance(l.geo_point, input.point) / 1000.0
    )::double precision as distance_km
  from public.locations l
  join public.location_types lt
    on lt.id = l.location_type_id
   and lt.tenant_id = l.tenant_id
  cross join input
  where l.tenant_id = p_tenant_id
    and l.status = 'active'
    and (
      p_type is null
      or lt.slug = p_type
    )
    and extensions.st_dwithin(
      l.geo_point,
      input.point,
      p_radius_km * 1000.0
    )
  order by
    extensions.st_distance(l.geo_point, input.point) asc
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.nearby_locations(
  uuid,
  double precision,
  double precision,
  double precision,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.nearby_locations(
  uuid,
  double precision,
  double precision,
  double precision,
  text,
  integer
) to service_role;

commit;
