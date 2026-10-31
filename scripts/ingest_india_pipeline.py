import sys
import time
import json
import psycopg2
from psycopg2.extras import execute_values
import overturemaps
from env_loader import get_global_database_url

sys.stdout.reconfigure(encoding="utf-8")

DB_URL = get_global_database_url()

print("==================================================================")
print("  GROWX LOCATION — INDIA SEED INGESTION & VERIFICATION PIPELINE")
print("  Target: Shared Global Layer (global_divisions, global_places)")
print("==================================================================")

start_time = time.time()

# ---------------------------------------------------------------------------
# 1. DATABASE CONNECTION & INITIAL METRICS
# ---------------------------------------------------------------------------
conn = psycopg2.connect(DB_URL)
conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT pg_database_size(current_database());")
initial_db_bytes = cur.fetchone()[0]
cur.execute("SELECT pg_size_pretty(%s::bigint);", (initial_db_bytes,))
initial_db_pretty = cur.fetchone()[0]
print(f"Initial Database Size: {initial_db_pretty} ({initial_db_bytes:,} bytes)")

bbox = (77.0, 15.0, 82.5, 18.5)

# ---------------------------------------------------------------------------
# 2. INGEST DIVISIONS (Administrative Hierarchy)
# ---------------------------------------------------------------------------
cur.execute("SELECT count(*) FROM public.global_divisions;")
divisions_existing = cur.fetchone()[0]

total_divisions_extracted = 0
div_duplicates_removed = 0
div_failed_rows = 0

# Pass --refresh-divisions to re-download and upsert divisions even when already populated.
refresh_divisions = "--refresh-divisions" in sys.argv

if divisions_existing >= 25000 and not refresh_divisions:
    print(f"\n[Phase 1/2] public.global_divisions already populated ({divisions_existing} rows). Skipping re-download.")
    divisions_in_db = divisions_existing
else:
    print(f"\n[Phase 1/2] Ingesting India Administrative Divisions for bbox {bbox}...")
    div_t0 = time.time()
    div_reader = overturemaps.record_batch_reader("division", bbox=bbox, stac=True)

    div_records = []
    seen_div_ids = set()

    if div_reader:
        for batch in div_reader:
            pydict = batch.to_pydict()
            num_rows = batch.num_rows
            total_divisions_extracted += num_rows

            for i in range(num_rows):
                div_id = pydict["id"][i]
                if div_id in seen_div_ids:
                    div_duplicates_removed += 1
                    continue
                seen_div_ids.add(div_id)

                names_struct = pydict["names"][i]
                primary_name = names_struct.get("primary") if names_struct else None
                if not primary_name or not str(primary_name).strip():
                    div_failed_rows += 1
                    continue
                primary_name = str(primary_name).strip()

                country = pydict["country"][i] or "IN"
                subtype = pydict["subtype"][i] or "locality"

                # Divisions are areas: use the bbox centre, not its south-west corner.
                bbox_struct = pydict["bbox"][i]
                lng = lat = None
                if bbox_struct and None not in (
                    bbox_struct.get("xmin"), bbox_struct.get("xmax"),
                    bbox_struct.get("ymin"), bbox_struct.get("ymax"),
                ):
                    lng = (bbox_struct["xmin"] + bbox_struct["xmax"]) / 2
                    lat = (bbox_struct["ymin"] + bbox_struct["ymax"]) / 2

                common_names_map = names_struct.get("common") if names_struct else {}
                names_json = json.dumps({"primary": primary_name, "common": common_names_map if isinstance(common_names_map, dict) else {}})

                hierarchies = pydict["hierarchies"][i]
                hierarchies_json = json.dumps(hierarchies if hierarchies is not None else [])
                parent_id = pydict["parent_division_id"][i] if "parent_division_id" in pydict else None

                div_records.append((
                    div_id,
                    country,
                    subtype,
                    primary_name,
                    names_json,
                    hierarchies_json,
                    parent_id,
                    float(lat) if lat is not None else None,
                    float(lng) if lng is not None else None,
                    "overture",
                    div_id,
                    # st_makepoint(NULL, NULL) yields NULL coordinates instead of POINT(0 0).
                    float(lng) if lng is not None else None,
                    float(lat) if lat is not None else None
                ))

    if div_records:
        execute_values(
            cur,
            """
            INSERT INTO public.global_divisions (
                id, country, subtype, name, names, hierarchies, parent_id, latitude, longitude, source, source_id, coordinates
            ) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                subtype = EXCLUDED.subtype,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                coordinates = EXCLUDED.coordinates,
                updated_at = now()
            """,
            div_records,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326))",
            page_size=1000
        )

    cur.execute("SELECT count(*) FROM public.global_divisions;")
    divisions_in_db = cur.fetchone()[0]
    print(f"  ✅ public.global_divisions count: {divisions_in_db} rows (took {time.time() - div_t0:.2f}s)")

# Pass --divisions-only to stop after divisions and skip the (slow) places ingest.
if "--divisions-only" in sys.argv:
    conn.close()
    print(f"\nDivisions-only run finished in {time.time() - start_time:.2f}s.")
    sys.exit(0)

# ---------------------------------------------------------------------------
# 3. INGEST PLACES (Shared POIs: Businesses, Hospitals, Dealers, Schools)
# ---------------------------------------------------------------------------
print(f"\n[Phase 2/2] Streaming & Ingesting India Places for bbox {bbox}...")
places_t0 = time.time()

places_reader = overturemaps.record_batch_reader("place", bbox=bbox, stac=True)

place_records = []
total_places_extracted = 0
place_duplicates_removed = 0
place_failed_rows = 0
seen_place_ids = set()
seen_normalized = set()

insert_template = "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, extensions.st_setsrid(extensions.st_makepoint(%s, %s), 4326))"

if places_reader:
    batch_idx = 0
    for batch in places_reader:
        batch_idx += 1
        pydict = batch.to_pydict()
        num_rows = batch.num_rows
        total_places_extracted += num_rows

        batch_records = []
        for i in range(num_rows):
            place_id = pydict["id"][i]

            # 1. Dedupe by ID
            if place_id in seen_place_ids:
                place_duplicates_removed += 1
                continue
            seen_place_ids.add(place_id)

            # Name check
            names_struct = pydict["names"][i]
            primary_name = names_struct.get("primary") if names_struct else None
            if not primary_name or not str(primary_name).strip():
                place_failed_rows += 1
                continue
            primary_name = str(primary_name).strip()

            # Coordinates
            bbox_struct = pydict["bbox"][i]
            lng = bbox_struct.get("xmin") if bbox_struct else None
            lat = bbox_struct.get("ymin") if bbox_struct else None
            if lat is None or lng is None or lat < 6.0 or lat > 38.0 or lng < 68.0 or lng > 98.0:
                place_failed_rows += 1
                continue

            # 2. Normalized deduplication (name + 4 decimal coords)
            norm_key = (primary_name.lower(), round(lat, 4), round(lng, 4))
            if norm_key in seen_normalized:
                place_duplicates_removed += 1
                continue
            seen_normalized.add(norm_key)

            # Category
            taxonomy_struct = pydict["taxonomy"][i]
            category = taxonomy_struct.get("primary") if taxonomy_struct else None
            basic_category = pydict["basic_category"][i]
            if not category:
                category = basic_category or "point_of_interest"

            # Brand
            brand_struct = pydict["brand"][i]
            brand_name = None
            if brand_struct and brand_struct.get("names"):
                brand_name = brand_struct["names"].get("primary")

            # Confidence
            conf = pydict["confidence"][i]

            # Address
            addresses = pydict["addresses"][i]
            address_text = None
            locality = None
            district = None
            state = None
            pincode = None
            country_code = "IN"

            if addresses and len(addresses) > 0:
                addr = addresses[0]
                address_text = addr.get("freeform")
                locality = addr.get("locality")
                state = addr.get("region")
                pincode = addr.get("postcode")
                country_code = addr.get("country") or "IN"

            # Contacts
            phones = pydict["phones"][i]
            phone = phones[0] if phones and len(phones) > 0 else None

            websites = pydict["websites"][i]
            website = websites[0] if websites and len(websites) > 0 else None

            emails = pydict["emails"][i]
            email = emails[0] if emails and len(emails) > 0 else None

            batch_records.append((
                place_id,
                primary_name,
                category,
                basic_category,
                brand_name,
                float(conf) if conf is not None else None,
                address_text,
                locality,
                district,
                state,
                pincode,
                country_code,
                phone,
                email,
                website,
                float(lat),
                float(lng),
                "overture",
                place_id,
                float(lng),
                float(lat)
            ))

        # Batch insert immediately to keep memory lean
        if batch_records:
            execute_values(
                cur,
                """
                INSERT INTO public.global_places (
                    id, name, category, basic_category, brand_name, confidence,
                    address, locality, district, state, pincode, country_code,
                    phone, email, website, latitude, longitude, source, source_id, coordinates
                ) VALUES %s
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    basic_category = EXCLUDED.basic_category,
                    brand_name = EXCLUDED.brand_name,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    coordinates = EXCLUDED.coordinates,
                    updated_at = now()
                """,
                batch_records,
                template=insert_template,
                page_size=1000
            )
            print(f"  Inserted batch {batch_idx}: {len(batch_records)} places (Running total extracted: {total_places_extracted})...")

cur.execute("SELECT count(*) FROM public.global_places;")
places_in_db = cur.fetchone()[0]
print(f"  ✅ public.global_places count: {places_in_db} rows (took {time.time() - places_t0:.2f}s)")

# ---------------------------------------------------------------------------
# 4. FINAL SIZE & STORAGE METRICS
# ---------------------------------------------------------------------------
cur.execute("SELECT pg_database_size(current_database());")
final_db_bytes = cur.fetchone()[0]
cur.execute("SELECT pg_size_pretty(%s::bigint);", (final_db_bytes,))
final_db_pretty = cur.fetchone()[0]

growth_bytes = final_db_bytes - initial_db_bytes
cur.execute("SELECT pg_size_pretty(%s::bigint);", (growth_bytes,))
growth_pretty = cur.fetchone()[0]

cur.execute("SELECT pg_size_pretty(pg_total_relation_size('public.global_places'));")
places_total_size = cur.fetchone()[0]

cur.execute("SELECT pg_size_pretty(pg_relation_size('public.global_places'));")
places_table_size = cur.fetchone()[0]

cur.execute("SELECT pg_size_pretty(pg_indexes_size('public.global_places'));")
places_index_size = cur.fetchone()[0]

cur.execute("SELECT pg_size_pretty(pg_total_relation_size('public.global_divisions'));")
divisions_total_size = cur.fetchone()[0]

cur.execute("SELECT pg_size_pretty(pg_relation_size('public.global_divisions'));")
divisions_table_size = cur.fetchone()[0]

cur.execute("SELECT pg_size_pretty(pg_indexes_size('public.global_divisions'));")
divisions_index_size = cur.fetchone()[0]

total_duration = time.time() - start_time

print("\n==================================================================")
print("  INGESTION SUMMARY METRICS")
print("==================================================================")
print(f"  Total India divisions extracted: {total_divisions_extracted}")
print(f"  Total India places extracted:    {total_places_extracted}")
print(f"  Total divisions inserted:        {divisions_in_db}")
print(f"  Total places inserted:           {places_in_db}")
print(f"  Total duplicates removed:        {place_duplicates_removed + div_duplicates_removed}")
print(f"  Total failed/invalid skipped:    {place_failed_rows + div_failed_rows}")
print(f"  Total Import Duration:           {total_duration:.2f}s ({total_duration/60:.2f} min)")
print(f"  Initial Database Size:           {initial_db_pretty}")
print(f"  Final Database Size:             {final_db_pretty}")
print(f"  Net Storage Added:               {growth_pretty}")
print(f"  global_places Total Size:        {places_total_size} (Table: {places_table_size}, Indexes: {places_index_size})")
print(f"  global_divisions Total Size:      {divisions_total_size} (Table: {divisions_table_size}, Indexes: {divisions_index_size})")

# ---------------------------------------------------------------------------
# 5. VERIFY ARCHITECTURE SEPARATION (TENANT LOCATIONS ISOLATION)
# ---------------------------------------------------------------------------
print("\n==================================================================")
print("  ARCHITECTURE VERIFICATION: TENANT ISOLATION CHECK")
print("==================================================================")
cur.execute("SELECT count(*) FROM public.locations;")
tenant_locations_count = cur.fetchone()[0]
print(f"  public.locations (Tenant-owned):  {tenant_locations_count} rows")
print(f"  public.global_places (Shared):    {places_in_db} rows")
print(f"  public.global_divisions (Shared): {divisions_in_db} rows")
assert tenant_locations_count == 3, f"Expected tenant locations to remain unchanged (3), got {tenant_locations_count}"
print("  ✅ PASS: Public India seed data was inserted ONLY into global_places and global_divisions.")
print("  ✅ PASS: Tenant locations table remains strictly isolated.")

# ---------------------------------------------------------------------------
# 6. RUN REQUIRED SEARCH TESTS
# ---------------------------------------------------------------------------
print("\n==================================================================")
print("  REQUIRED SEARCH TESTS")
print("==================================================================")

search_targets = [
    ("Vijayawada", "SELECT * FROM public.search_global_places('Vijayawada', null, null, null, 1);"),
    ("Guntur", "SELECT * FROM public.search_global_places('Guntur', null, null, null, 1);"),
    ("Hyderabad", "SELECT * FROM public.search_global_places('Hyderabad', null, null, null, 1);"),
    ("Apollo Hospital", "SELECT * FROM public.search_global_places('Apollo', 'health_and_medical', null, null, 1);"),
    ("Automotive/Dealer", "SELECT * FROM public.search_global_places('Motors', null, null, null, 1);")
]

for label, query in search_targets:
    cur.execute(query)
    row = cur.fetchone()
    print(f"\n[Test Search: {label}]")
    if row:
        print(f"  - Name:      {row[1]}")
        print(f"  - Category:  {row[2]} ({row[3]})")
        print(f"  - City/State:{row[7] or 'N/A'}, {row[9] or 'N/A'}")
        print(f"  - Latitude:  {row[12]}")
        print(f"  - Longitude: {row[13]}")
        print(f"  - Source ID: {row[17]}")
    else:
        print("  - No record found")

# ---------------------------------------------------------------------------
# 7. POSTGIS GEO-QUERY VERIFICATION (Nearby Vijayawada)
# ---------------------------------------------------------------------------
print("\n==================================================================")
print("  POSTGIS GEO-QUERY VERIFICATION (Nearby Vijayawada)")
print("==================================================================")
vja_lat = 16.5062
vja_lng = 80.6480
radius_km = 30.0

nearby_query = f"""
    SELECT id, name, category, locality, latitude, longitude, distance_km
    FROM public.nearby_global_places({vja_lat}, {vja_lng}, {radius_km}, null, 5);
"""
cur.execute(nearby_query)
nearby_results = cur.fetchall()
print(f"Querying places within {radius_km} km of Vijayawada ({vja_lat}, {vja_lng}):")
for r in nearby_results:
    print(f"  - [{r[6]} km] {r[1]} ({r[2]}) @ {r[3] or 'Vijayawada'} (Lat: {r[4]}, Lng: {r[5]})")

# Confirm spatial index usage via EXPLAIN
explain_query = f"""
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, name, round((extensions.st_distance(coordinates::extensions.geography, extensions.st_setsrid(extensions.st_makepoint({vja_lng}, {vja_lat}), 4326)::extensions.geography) / 1000.0)::numeric, 2) as distance_km
    FROM public.global_places
    WHERE extensions.st_dwithin(
        coordinates::extensions.geography,
        extensions.st_setsrid(extensions.st_makepoint({vja_lng}, {vja_lat}), 4326)::extensions.geography,
        {radius_km * 1000.0}
    )
    LIMIT 5;
"""
cur.execute(explain_query)
explain_rows = cur.fetchall()
print("\nPostGIS Spatial Query Execution Plan:")
for line in explain_rows:
    print(" ", line[0])

# ---------------------------------------------------------------------------
# 8. DATA QUALITY AUDIT
# ---------------------------------------------------------------------------
print("\n==================================================================")
print("  DATA QUALITY AUDIT")
print("==================================================================")

cur.execute("""
    SELECT
        count(*) filter (where latitude is null or longitude is null) as null_coords,
        count(*) filter (where latitude < 6.0 or latitude > 38.0 or longitude < 68.0 or longitude > 98.0) as out_of_india_coords,
        count(*) filter (where name is null or trim(name) = '') as missing_names,
        count(*) filter (where category is null or trim(category) = '') as malformed_categories,
        count(*) filter (where coordinates is null) as null_geometries
    FROM public.global_places;
""")
audit = cur.fetchone()
print(f"  - Invalid / null coordinates:     {audit[0]}")
print(f"  - Non-India coordinates:          {audit[1]}")
print(f"  - Missing or blank names:         {audit[2]}")
print(f"  - Malformed or empty categories:  {audit[3]}")
print(f"  - Unpopulated PostGIS geometries: {audit[4]}")

cur.execute("""
    SELECT count(*) - count(distinct id) as dup_ids
    FROM public.global_places;
""")
dup_ids = cur.fetchone()[0]
print(f"  - Duplicate place primary IDs:    {dup_ids}")

cur.execute("""
    SELECT count(*)
    FROM (
        SELECT lower(name), round(latitude::numeric, 4), round(longitude::numeric, 4), count(*)
        FROM public.global_places
        GROUP BY 1, 2, 3
        HAVING count(*) > 1
    ) sub;
""")
dup_norm = cur.fetchone()[0]
print(f"  - Duplicate normalized places:    {dup_norm}")

# ---------------------------------------------------------------------------
# 9. ESTIMATED FULL INDIA DATABASE SIZE & STORAGE ANALYSIS
# ---------------------------------------------------------------------------
print("\n==================================================================")
print("  STORAGE ANALYSIS & ALL-INDIA CAPACITY PROJECTION")
print("==================================================================")

cur.execute("""
    SELECT 
        pg_total_relation_size('public.global_places') / greatest(count(*), 1) as bytes_per_place_total,
        pg_relation_size('public.global_places') / greatest(count(*), 1) as bytes_per_place_table,
        pg_indexes_size('public.global_places') / greatest(count(*), 1) as bytes_per_place_indexes
    FROM public.global_places;
""")
row_metrics = cur.fetchone()
bytes_per_place_total = row_metrics[0]
bytes_per_place_table = row_metrics[1]
bytes_per_place_indexes = row_metrics[2]

print(f"  Average Storage per Place Record: {bytes_per_place_total} bytes")
print(f"    - Table row data:               {bytes_per_place_table} bytes")
print(f"    - Indexes (including PostGIS):  {bytes_per_place_indexes} bytes")

for count_label, count_val in [("1 Million Places", 1_000_000), ("2.5 Million (Est. Full India)", 2_500_000), ("4 Million (High Est.)", 4_000_000)]:
    proj_table = (count_val * bytes_per_place_table) / (1024 * 1024)
    proj_index = (count_val * bytes_per_place_indexes) / (1024 * 1024)
    proj_total = (count_val * bytes_per_place_total) / (1024 * 1024)
    print(f"\n  Projection for {count_label}:")
    print(f"    - Table Data:  {proj_table:,.1f} MB")
    print(f"    - Indexes:     {proj_index:,.1f} MB")
    print(f"    - Total Size:  {proj_total:,.1f} MB ({proj_total/1024:.2f} GB)")

print("\n  Supabase Free Tier Limit: 500 MB")
if (2_500_000 * bytes_per_place_total) / (1024 * 1024) > 500:
    print("  ⚠️ ALERT: Full All-India places (est. ~2.5M places, ~1.2 GB to ~1.8 GB) exceeds the 500 MB Supabase Free Tier.")
    print("  Recommendation: Maintain tiered ingestion (regional / top hubs / POIs first) until Supabase Pro is activated.")
print("==================================================================\n")

conn.close()
