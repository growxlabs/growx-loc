import sys
import psycopg2
from env_loader import get_global_database_url

sys.stdout.reconfigure(encoding="utf-8")

db_url = get_global_database_url()
conn = psycopg2.connect(db_url)
cur = conn.cursor()

targets = [
    ("Vijayawada", "SELECT id, name, category, basic_category, locality, state, latitude, longitude, source_id FROM public.search_global_places('Vijayawada', NULL, NULL, NULL, 1);"),
    ("Guntur", "SELECT id, name, category, basic_category, locality, state, latitude, longitude, source_id FROM public.search_global_places('Guntur', NULL, NULL, NULL, 1);"),
    ("Hyderabad", "SELECT id, name, category, basic_category, locality, state, latitude, longitude, source_id FROM public.search_global_places('Hyderabad', NULL, NULL, NULL, 1);"),
    ("Apollo Hospital", "SELECT id, name, category, basic_category, locality, state, latitude, longitude, source_id FROM public.global_places WHERE name ILIKE '%Apollo%' AND (category ILIKE '%hospital%' OR basic_category ILIKE '%hospital%') LIMIT 1;"),
    ("Automotive / Dealer", "SELECT id, name, category, basic_category, locality, state, latitude, longitude, source_id FROM public.global_places WHERE name ILIKE '%Motors%' AND (category ILIKE '%dealer%' OR category ILIKE '%auto%' OR basic_category ILIKE '%vehicle%') LIMIT 1;")
]

print("=== EXACT SEARCH TESTS ===")
for label, sql in targets:
    cur.execute(sql)
    r = cur.fetchone()
    print(f"\nTarget: {label}")
    if r:
        print(f"  - Returned Name: {r[1]}")
        print(f"  - Category:      {r[2]} ({r[3]})")
        print(f"  - City / State:  {r[4] or 'N/A'}, {r[5] or 'N/A'}")
        print(f"  - Latitude:      {r[6]}")
        print(f"  - Longitude:     {r[7]}")
        print(f"  - Source ID:     {r[8]}")
    else:
        print("  - Not found")

conn.close()
