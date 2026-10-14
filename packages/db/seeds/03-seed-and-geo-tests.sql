-- Growx Location
-- 03-seed-and-geo-tests.sql
--
-- Purpose:
--   Seed minimal V1 test data and verify that:
--   1. tenant isolation fields are present
--   2. location geo_point is populated automatically
--   3. nearby search works
--   4. distance calculation works
--   5. radius service-area checks work
--
-- Prerequisite:
--   Run 02-initial-database-migration.sql first.
--
-- Safe to re-run:
--   Yes. This file uses upserts / conflict handling where appropriate.

begin;

-- ---------------------------------------------------------------------------
-- 1. SEED TENANT
-- ---------------------------------------------------------------------------

insert into public.tenants (
  name,
  slug,
  status
)
values (
  'GrowxLabs',
  'growxlabs',
  'active'
)
on conflict (slug)
do update set
  name = excluded.name,
  status = excluded.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. SEED LOCATION TYPE
-- ---------------------------------------------------------------------------

insert into public.location_types (
  tenant_id,
  name,
  slug
)
select
  t.id,
  'Office',
  'office'
from public.tenants t
where t.slug = 'growxlabs'
on conflict (tenant_id, slug)
do update set
  name = excluded.name,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. SEED TEST LOCATION
-- ---------------------------------------------------------------------------
--
-- Public city-centre style test coordinates are used only to validate PostGIS.
-- Replace this test record later with real GrowxLabs/client data.

insert into public.locations (
  tenant_id,
  location_type_id,
  name,
  slug,
  address_line_1,
  city,
  district,
  state,
  pincode,
  country_code,
  latitude,
  longitude,
  metadata,
  status
)
select
  t.id,
  lt.id,
  'GrowxLabs Vijayawada Test',
  'growxlabs-vijayawada-test',
  'Vijayawada Test Location',
  'Vijayawada',
  'NTR',
  'Andhra Pradesh',
  '520001',
  'IN',
  16.5062,
  80.6480,
  jsonb_build_object(
    'purpose', 'postgis-verification',
    'test_record', true
  ),
  'active'
from public.tenants t
join public.location_types lt
  on lt.tenant_id = t.id
 and lt.slug = 'office'
where t.slug = 'growxlabs'
on conflict (tenant_id, slug)
do update set
  location_type_id = excluded.location_type_id,
  name = excluded.name,
  address_line_1 = excluded.address_line_1,
  city = excluded.city,
  district = excluded.district,
  state = excluded.state,
  pincode = excluded.pincode,
  country_code = excluded.country_code,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  metadata = excluded.metadata,
  status = excluded.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. SEED LOCATION SOURCE
-- ---------------------------------------------------------------------------

insert into public.location_sources (
  tenant_id,
  location_id,
  source_type,
  source_reference,
  verified_at,
  metadata
)
select
  l.tenant_id,
  l.id,
  'growx',
  '03-seed-and-geo-tests.sql',
  now(),
  jsonb_build_object(
    'test_record', true
  )
from public.locations l
join public.tenants t
  on t.id = l.tenant_id
where t.slug = 'growxlabs'
  and l.slug = 'growxlabs-vijayawada-test'
  and not exists (
    select 1
    from public.location_sources s
    where s.location_id = l.id
      and s.source_type = 'growx'
      and s.source_reference = '03-seed-and-geo-tests.sql'
  );

-- ---------------------------------------------------------------------------
-- 5. SEED RADIUS SERVICE AREA
-- ---------------------------------------------------------------------------

insert into public.service_areas (
  tenant_id,
  location_id,
  name,
  area_type,
  radius_km,
  metadata,
  status
)
select
  l.tenant_id,
  l.id,
  'GrowxLabs Vijayawada Test Radius',
  'radius',
  25.000,
  jsonb_build_object(
    'test_record', true
  ),
  'active'
from public.locations l
join public.tenants t
  on t.id = l.tenant_id
where t.slug = 'growxlabs'
  and l.slug = 'growxlabs-vijayawada-test'
  and not exists (
    select 1
    from public.service_areas sa
    where sa.location_id = l.id
      and sa.name = 'GrowxLabs Vijayawada Test Radius'
      and sa.area_type = 'radius'
  );

commit;

-- ===========================================================================
-- VERIFICATION QUERIES
-- Run these after the seed transaction succeeds.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. VERIFY SEEDED TENANT
-- ---------------------------------------------------------------------------

select
  id,
  name,
  slug,
  status,
  created_at
from public.tenants
where slug = 'growxlabs';

-- Expected:
-- exactly 1 row

-- ---------------------------------------------------------------------------
-- B. VERIFY LOCATION TYPE
-- ---------------------------------------------------------------------------

select
  lt.id,
  lt.name,
  lt.slug,
  t.slug as tenant_slug
from public.location_types lt
join public.tenants t
  on t.id = lt.tenant_id
where t.slug = 'growxlabs'
  and lt.slug = 'office';

-- Expected:
-- exactly 1 row

-- ---------------------------------------------------------------------------
-- C. VERIFY LOCATION + GENERATED POSTGIS POINT
-- ---------------------------------------------------------------------------

select
  l.id,
  l.name,
  l.city,
  l.state,
  l.latitude,
  l.longitude,
  extensions.st_astext(l.geo_point::extensions.geometry) as geo_point_wkt
from public.locations l
join public.tenants t
  on t.id = l.tenant_id
where t.slug = 'growxlabs'
  and l.slug = 'growxlabs-vijayawada-test';

-- Expected geo_point_wkt:
-- POINT(80.648 16.5062)
--
-- Longitude appears first in WKT because geometry points are X/Y = lng/lat.

-- ---------------------------------------------------------------------------
-- D. VERIFY DISTANCE CALCULATION
-- ---------------------------------------------------------------------------
--
-- Test point is intentionally close to the seeded location.

with test_point as (
  select
    extensions.st_setsrid(
      extensions.st_makepoint(80.6600, 16.5150),
      4326
    )::extensions.geography as point
)
select
  l.name,
  round(
    (
      extensions.st_distance(l.geo_point, tp.point) / 1000.0
    )::numeric,
    3
  ) as distance_km
from public.locations l
cross join test_point tp
join public.tenants t
  on t.id = l.tenant_id
where t.slug = 'growxlabs'
  and l.slug = 'growxlabs-vijayawada-test';

-- Expected:
-- one row
-- a small positive distance in kilometres

-- ---------------------------------------------------------------------------
-- E. VERIFY NEARBY SEARCH
-- ---------------------------------------------------------------------------
--
-- This is the core shape used later by:
-- GET /v1/nearby?lat=&lng=&radius=

with search_input as (
  select
    extensions.st_setsrid(
      extensions.st_makepoint(80.6600, 16.5150),
      4326
    )::extensions.geography as point,
    5000.0::double precision as radius_meters
)
select
  l.id,
  l.name,
  l.city,
  l.state,
  round(
    (
      extensions.st_distance(l.geo_point, si.point) / 1000.0
    )::numeric,
    3
  ) as distance_km
from public.locations l
cross join search_input si
join public.tenants t
  on t.id = l.tenant_id
where t.slug = 'growxlabs'
  and l.status = 'active'
  and extensions.st_dwithin(
    l.geo_point,
    si.point,
    si.radius_meters
  )
order by
  extensions.st_distance(l.geo_point, si.point) asc;

-- Expected:
-- seeded Vijayawada test location should be returned.

-- ---------------------------------------------------------------------------
-- F. VERIFY RADIUS SERVICE-AREA CHECK
-- ---------------------------------------------------------------------------

with customer_point as (
  select
    extensions.st_setsrid(
      extensions.st_makepoint(80.6600, 16.5150),
      4326
    )::extensions.geography as point
)
select
  sa.id as service_area_id,
  sa.name as service_area_name,
  l.id as location_id,
  l.name as location_name,
  sa.radius_km,
  extensions.st_dwithin(
    l.geo_point,
    cp.point,
    sa.radius_km * 1000.0
  ) as covered,
  round(
    (
      extensions.st_distance(l.geo_point, cp.point) / 1000.0
    )::numeric,
    3
  ) as distance_km
from public.service_areas sa
join public.locations l
  on l.id = sa.location_id
join public.tenants t
  on t.id = sa.tenant_id
cross join customer_point cp
where t.slug = 'growxlabs'
  and sa.area_type = 'radius'
  and sa.status = 'active'
  and l.slug = 'growxlabs-vijayawada-test';

-- Expected:
-- covered = true

-- ---------------------------------------------------------------------------
-- G. VERIFY TENANT-SCOPED LOCATION QUERY
-- ---------------------------------------------------------------------------

select
  l.id,
  l.name,
  lt.slug as location_type,
  l.city,
  l.state,
  l.pincode,
  l.status
from public.locations l
join public.tenants t
  on t.id = l.tenant_id
join public.location_types lt
  on lt.id = l.location_type_id
where t.slug = 'growxlabs'
order by l.created_at desc;

-- This is the pattern the backend must follow:
-- resolve tenant from API key, then query only that tenant's rows.

-- ---------------------------------------------------------------------------
-- H. VERIFY INDEXES
-- ---------------------------------------------------------------------------

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'api_keys',
    'location_types',
    'locations',
    'service_areas',
    'location_sources'
  )
order by tablename, indexname;

-- Confirm that locations_geo_point_gist_idx exists.

-- ---------------------------------------------------------------------------
-- I. VERIFY RLS IS ENABLED
-- ---------------------------------------------------------------------------

select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'tenants',
    'api_keys',
    'location_types',
    'locations',
    'service_areas',
    'location_sources'
  )
order by tablename;

-- Expected:
-- rowsecurity = true for all rows.
