import os
import secrets
import hashlib
import json
import psycopg2
from pathlib import Path

from env_loader import get_database_url

def main():
    db_url = get_database_url()

    # Generate new random 32 bytes (64 hex characters)
    raw_hex = secrets.token_hex(32)
    raw_key = f"gx_loc_{raw_hex}"
    key_prefix = raw_key[:18]
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    # Get primary tenant id
    cur.execute("SELECT id FROM public.tenants WHERE slug = 'growxlabs' LIMIT 1;")
    tenant_row = cur.fetchone()
    if not tenant_row:
        raise ValueError("Tenant growxlabs not found")
    tenant_id = tenant_row[0]

    permissions = [
        "locations:read",
        "locations:write",
        "imports:read",
        "imports:write",
        "service-areas:read",
        "service-areas:write"
    ]

    # Insert new key
    cur.execute("""
        INSERT INTO public.api_keys (
            tenant_id,
            name,
            key_prefix,
            key_hash,
            permissions,
            status
        ) VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id;
    """, (
        tenant_id,
        "Production API Key (Rotated)",
        key_prefix,
        key_hash,
        json.dumps(permissions),
        "active"
    ))
    new_key_id = cur.fetchone()[0]

    # Revoke all older active keys for this tenant
    cur.execute("""
        UPDATE public.api_keys
        SET status = 'revoked', updated_at = NOW()
        WHERE tenant_id = %s AND id != %s AND status = 'active';
    """, (tenant_id, new_key_id))
    revoked_count = cur.rowcount

    conn.commit()
    conn.close()

    # Update .env files without printing keys
    for p in [Path(".env"), Path("packages/db/.env")]:
        if p.exists():
            lines = p.read_text(encoding="utf-8").splitlines()
            updated = False
            new_lines = []
            for line in lines:
                if line.startswith("GROWX_LOCATION_API_KEY=") or line.startswith("API_KEY="):
                    continue
                new_lines.append(line)
            new_lines.append(f"GROWX_LOCATION_API_KEY={raw_key}")
            new_lines.append(f"API_KEY={raw_key}")
            p.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    print(f"SUCCESS: Created new API key id={new_key_id}, revoked {revoked_count} old keys, updated .env")

if __name__ == "__main__":
    main()
