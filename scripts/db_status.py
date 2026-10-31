import os
import psycopg2
from env_loader import get_database_url

db_url = get_database_url()

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    cur.execute("SELECT pg_size_pretty(pg_database_size(current_database())), pg_database_size(current_database());")
    res = cur.fetchone()
    print(f"Current DB Size: {res[0]} ({res[1]:,} bytes)")

    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
    """)
    tables = [r[0] for r in cur.fetchall()]
    print(f"Public tables: {tables}")

    for table in tables:
        cur.execute(f"SELECT pg_size_pretty(pg_total_relation_size('public.{table}')), count(*) FROM public.{table};")
        size, count = cur.fetchone()
        print(f"  - {table}: {count:,} rows, {size}")

    conn.close()
except Exception as e:
    print("Connection error:", e)
