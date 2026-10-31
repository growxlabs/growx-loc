import json
import sys
import psycopg2
from env_loader import get_global_database_url

sys.stdout.reconfigure(encoding="utf-8")

db2_url = get_global_database_url()

print("Connecting to DB2 to export divisions...")
conn = psycopg2.connect(db2_url)
cur = conn.cursor()

cur.execute("""
    SELECT id, country, subtype, name, names, parent_id, latitude, longitude, source, source_id
    FROM public.global_divisions
    ORDER BY 
        CASE subtype
            WHEN 'country' THEN 1
            WHEN 'region' THEN 2
            WHEN 'county' THEN 3
            ELSE 4
        END, name;
""")
rows = cur.fetchall()
print(f"Fetched {len(rows)} divisions from DB2.")

def escape_sql(val):
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''")
    return f"'{s}'"

with open("packages/db/migrations/d1-seed-divisions.sql", "w", encoding="utf-8") as f:
    f.write("-- D1 Seed Data for divisions (no BEGIN/COMMIT statements)\n")
    
    batch_size = 200
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        values_list = []
        for r in chunk:
            id_val = escape_sql(r[0])
            country_val = escape_sql(r[1])
            subtype_val = escape_sql(r[2])
            name_val = escape_sql(r[3])
            names_json = escape_sql(json.dumps(r[4]) if r[4] is not None else None)
            parent_val = escape_sql(r[5])
            lat_val = escape_sql(r[6])
            lng_val = escape_sql(r[7])
            src_val = escape_sql(r[8])
            src_id_val = escape_sql(r[9])
            values_list.append(f"({id_val}, {country_val}, {subtype_val}, {name_val}, {names_json}, {parent_val}, {lat_val}, {lng_val}, {src_val}, {src_id_val})")
        
        # REPLACE so re-running the seed updates rows already in D1 (e.g. corrected coordinates).
        sql = f"INSERT OR REPLACE INTO divisions (id, country, subtype, name, names_json, parent_id, latitude, longitude, source, source_id) VALUES\n" + ",\n".join(values_list) + ";\n"
        f.write(sql)

conn.close()
print("Saved SQL file to packages/db/migrations/d1-seed-divisions.sql")
