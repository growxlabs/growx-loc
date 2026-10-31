import sys
import psycopg2
from env_loader import get_global_database_url

sys.stdout.reconfigure(encoding="utf-8")

db_url = get_global_database_url()
conn = psycopg2.connect(db_url)
cur = conn.cursor()

targets = ["Vijayawada", "Guntur", "Hyderabad", "Andhra Pradesh", "Telangana"]

print("=== DIVISIONS SEARCH TESTS ===")
for query in targets:
    cur.execute("SELECT id, name, subtype, country, latitude, longitude, source_id FROM public.search_global_divisions(%s, NULL, 1);", (query,))
    r = cur.fetchone()
    print(f"\nDivision Query: {query}")
    if r:
        print(f"  - Name:      {r[1]}")
        print(f"  - Subtype:   {r[2]}")
        print(f"  - Country:   {r[3]}")
        print(f"  - Lat / Lng: {r[4]}, {r[5]}")
        print(f"  - Source ID: {r[6]}")
    else:
        print("  - Not found")

conn.close()
