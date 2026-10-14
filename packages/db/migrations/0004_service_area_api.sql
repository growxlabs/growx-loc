begin;

-- Pincode membership lookup.
create index if not exists service_areas_pincodes_gin_idx
  on public.service_areas
  using gin (pincodes)
  where pincodes is not null;


-- ---------------------------------------------------------------------------
-- COVERAGE CHECK
-- ---------------------------------------------------------------------------

create or replace function public.check_service_area(
  p_tenant_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_pincode text default null
)
returns table (
  service_area_id uuid,
  service_area_name text,
  area_type text,
  location_id uuid,
  location_name text,
  covered boolean,
  distance_km double precision
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with input_point as (
    select
      case
        when p_lat is not null and p_lng is not null
        then extensions.st_setsrid(
          extensions.st_makepoint(p_lng, p_lat),
          4326
        )::extensions.geography
        else null
      end as point
  )
  select
    sa.id as service_area_id,
    sa.name as service_area_name,
    sa.area_type,
    l.id as location_id,
    l.name as location_name,

    case
      when sa.area_type = 'radius'
        and ip.point is not null
        and l.id is not null
      then extensions.st_dwithin(
        l.geo_point,
        ip.point,
        sa.radius_km * 1000.0
      )

      when sa.area_type = 'pincode_list'
        and p_pincode is not null
      then btrim(p_pincode) = any(sa.pincodes)

      else false
    end as covered,

    case
      when sa.area_type = 'radius'
        and ip.point is not null
        and l.id is not null
      then (
        extensions.st_distance(l.geo_point, ip.point) / 1000.0
      )::double precision
      else null
    end as distance_km

  from public.service_areas sa

  left join public.locations l
    on l.id = sa.location_id
   and l.tenant_id = sa.tenant_id
   and l.status = 'active'

  cross join input_point ip

  where sa.tenant_id = p_tenant_id
    and sa.status = 'active'
    and sa.area_type in ('radius', 'pincode_list')
    and (
      (
        sa.area_type = 'radius'
        and p_lat is not null
        and p_lng is not null
        and l.id is not null
      )
      or
      (
        sa.area_type = 'pincode_list'
        and p_pincode is not null
      )
    )
    and (
      (
        sa.area_type = 'radius'
        and extensions.st_dwithin(
          l.geo_point,
          ip.point,
          sa.radius_km * 1000.0
        )
      )
      or
      (
        sa.area_type = 'pincode_list'
        and btrim(p_pincode) = any(sa.pincodes)
      )
    )

  order by
    case
      when sa.area_type = 'radius'
      then extensions.st_distance(l.geo_point, ip.point)
      else null
    end asc nulls last,
    sa.name asc;
$$;

revoke all on function public.check_service_area(
  uuid,
  double precision,
  double precision,
  text
) from public, anon, authenticated;

grant execute on function public.check_service_area(
  uuid,
  double precision,
  double precision,
  text
) to service_role;

commit;
