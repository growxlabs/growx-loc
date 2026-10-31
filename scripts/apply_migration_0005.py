import sys
import psycopg2
from env_loader import get_global_database_url

sys.stdout.reconfigure(encoding="utf-8")

db_url = get_global_database_url()

print("Connecting to Supabase PostgreSQL (Global DB)...")
conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

# Optional argument: another global migration file, e.g. 0006_global_search_hardening.sql
migration_path = sys.argv[1] if len(sys.argv) > 1 else "packages/db/migrations/0005_global_places_and_divisions.sql"

with open(migration_path, "r", encoding="utf-8") as f:
    sql = f.read()

print(f"Applying migration {migration_path}...")
cur.execute(sql)
print("Migration applied successfully!")

cur.execute("""
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name LIKE 'global_%';
""")
print("Created tables:", cur.fetchall())

conn.close()
