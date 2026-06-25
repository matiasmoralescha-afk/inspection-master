-- Migration 001: add location and reinspection_due_date fields
-- Run locally:  sqlite3 data/inspection_agent.db < migrations/001_add_location_reinspection.sql
-- Run on Supabase: paste into SQL editor at https://supabase.com/dashboard/project/vrqkjzcmpnltkggbxonp/sql

-- SQLite & PostgreSQL compatible syntax
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS reinspection_due_date text;

-- SQLite doesn't support IF NOT EXISTS on ALTER TABLE — use this instead for local DB:
-- ALTER TABLE shipments ADD COLUMN location TEXT;
-- ALTER TABLE shipments ADD COLUMN reinspection_due_date TEXT;
