-- Growx Location
-- 0007_global_search_performance.sql
--
-- Target: Supabase PostgreSQL (Global DB)
-- Purpose: Keep global place search fast enough for autocomplete.
--          - plpgsql + force_custom_plan so each call is planned with the real
--            search text and can use the trigram indexes from 0006
--          - queries shorter than 3 characters (no trigrams) use a name-prefix
--            match backed by a B-tree pattern index instead of a full scan

begin;

create index if not exists global_places_name_prefix_idx
  on public.global_places (lower(name) text_pattern_ops);

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
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, extensions
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_query text := btrim(p_query);
  v_pattern text := public.escape_like(btrim(p_query));
  v_category text := public.escape_like(p_category);
  v_locality text := public.escape_like(p_locality);
  v_state text := public.escape_like(p_state);
  v_limit integer := least(greatest(p_limit, 1), 100);
begin
  if v_query is null or v_query = '' then
    return;
  end if;

  if length(v_query) < 3 then
    return query
      select
        p.id, p.name, p.category, p.basic_category, p.brand_name, p.confidence,
        p.address, p.locality, p.district, p.state, p.pincode, p.country_code,
        p.latitude, p.longitude, p.phone, p.website, p.source, p.source_id
      from public.global_places p
      where
        lower(p.name) like lower(v_pattern) || '%'
        and (v_category is null or p.category ilike v_category or p.basic_category ilike v_category)
        and (v_locality is null or coalesce(p.locality, '') ilike '%' || v_locality || '%')
        and (v_state is null or coalesce(p.state, '') ilike '%' || v_state || '%')
      order by
        case when lower(p.name) = lower(v_query) then 0 else 1 end,
        p.confidence desc nulls last,
        p.name asc
      limit v_limit;
    return;
  end if;

  return query
    select
      p.id, p.name, p.category, p.basic_category, p.brand_name, p.confidence,
      p.address, p.locality, p.district, p.state, p.pincode, p.country_code,
      p.latitude, p.longitude, p.phone, p.website, p.source, p.source_id
    from public.global_places p
    where
      (v_category is null or p.category ilike v_category or p.basic_category ilike v_category)
      and (v_locality is null or coalesce(p.locality, '') ilike '%' || v_locality || '%')
      and (v_state is null or coalesce(p.state, '') ilike '%' || v_state || '%')
      and (
        p.name ilike '%' || v_pattern || '%'
        or coalesce(p.brand_name, '') ilike '%' || v_pattern || '%'
        or coalesce(p.locality, '') ilike '%' || v_pattern || '%'
        or coalesce(p.address, '') ilike '%' || v_pattern || '%'
      )
    order by
      case
        when lower(p.name) = lower(v_query) then 0
        when p.name ilike v_pattern || '%' then 1
        when lower(coalesce(p.locality, '')) = lower(v_query) then 2
        else 3
      end,
      p.confidence desc nulls last,
      p.name asc
    limit v_limit;
end;
$$;

commit;
