import time
import psycopg2
from env_loader import get_global_database_url

def main():
    db_url = get_global_database_url()
    print("Connecting to Supabase Global DB (DB2)...")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    query = """
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT *
    FROM public.nearby_global_places(
      p_lat := 16.5062,
      p_lng := 80.6480,
      p_radius_km := 10.0,
      p_category := NULL,
      p_limit := 20
    );
    """

    # 1. EXPLAIN ANALYZE BEFORE INDEX
    print("\n--- Running EXPLAIN ANALYZE BEFORE index creation ---")
    cur.execute(query)
    explain_before = "\n".join(r[0] for r in cur.fetchall())
    print(explain_before)

    # 2. CREATE FUNCTIONAL GEOGRAPHY INDEX
    print("\n--- Creating functional geography index: global_places_geog_gix ---")
    t0 = time.time()
    cur.execute("""
        CREATE INDEX IF NOT EXISTS global_places_geog_gix
        ON public.global_places
        USING gist ((coordinates::extensions.geography));
    """)
    idx_duration = time.time() - t0
    print(f"Index created/verified in {idx_duration:.2f}s")

    # Update statistics
    print("Updating optimizer statistics (ANALYZE public.global_places)...")
    cur.execute("ANALYZE public.global_places;")

    # 3. EXPLAIN ANALYZE AFTER INDEX
    print("\n--- Running EXPLAIN ANALYZE AFTER index creation ---")
    cur.execute(query)
    explain_after = "\n".join(r[0] for r in cur.fetchall())
    print(explain_after)

    conn.close()

if __name__ == "__main__":
    main()
