-- Cloudflare D1 Reference Schema
-- Database: growx-location-reference (4db529a7-a487-4a41-9ae3-3a288f4d4270)
-- Purpose: Sub-millisecond edge lookups for India administrative divisions (States, Districts, Localities)

CREATE TABLE IF NOT EXISTS divisions (
  id TEXT PRIMARY KEY,
  country TEXT NOT NULL DEFAULT 'IN',
  subtype TEXT NOT NULL,
  name TEXT NOT NULL,
  names_json TEXT,
  parent_id TEXT,
  latitude REAL,
  longitude REAL,
  source TEXT NOT NULL DEFAULT 'overture',
  source_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_divisions_name ON divisions(name);
CREATE INDEX IF NOT EXISTS idx_divisions_subtype ON divisions(subtype);
CREATE INDEX IF NOT EXISTS idx_divisions_country_subtype ON divisions(country, subtype);
