# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cerebro — Base de conocimiento (Obsidian)

El vault de Obsidian en `~/ELITE_OBSIDIAN/ELITE/` es la fuente de verdad operativa. Al iniciar una sesión, lee estos archivos para tener contexto completo:

```
~/ELITE_OBSIDIAN/ELITE/Cerebro/00 - Índice.md          ← punto de entrada
~/ELITE_OBSIDIAN/ELITE/Cerebro/01 - Arquitectura.md    ← visión general del sistema
~/ELITE_OBSIDIAN/ELITE/Cerebro/02 - Agente.md          ← lógica del agente Python
~/ELITE_OBSIDIAN/ELITE/Cerebro/03 - Base de Datos.md   ← schema SQLite + Supabase
~/ELITE_OBSIDIAN/ELITE/Cerebro/04 - Dashboard Web.md   ← Next.js + dark mode
~/ELITE_OBSIDIAN/ELITE/Cerebro/05 - Clientes y Config.md
~/ELITE_OBSIDIAN/ELITE/Cerebro/06 - Notificaciones.md
~/ELITE_OBSIDIAN/ELITE/Cerebro/07 - Issues y TODOs.md  ← bugs activos y pendientes
```

Notas de operaciones diarias: `~/ELITE_OBSIDIAN/ELITE/YYYY-MM-DD Operaciones.md`

**Regla:** Cuando termines una tarea importante, actualiza el archivo relevante del Cerebro. Si es un bug resuelto → `07 - Issues y TODOs.md`. Si es un cambio de arquitectura → el archivo correspondiente. Si es contexto operativo del día → crea o actualiza la nota de operaciones.

## Commands

```bash
# Install
pip install -e .

# Run agent (production mode — reads Gmail, writes to SQLite + Supabase + Sheets)
python -m agent.main

# Dry-run (parses emails, logs records, does NOT write to DB or Sheets)
python -m agent.main --dry-run

# Restrict to last N hours of email (useful for quick test runs)
python -m agent.main --since-hours 2 --dry-run

# Self-healing window: size the Gmail search from the last processed email in
# Supabase (+2h margin, clamped 4h–14d). This is what GitHub Actions runs.
python -m agent.main --auto-window

# Run all tests
python -m pytest tests/

# Run a single test file
python -m pytest tests/test_normalizers.py -v

# Run a single test
python -m pytest tests/test_ocean_parser.py::TestOceanParser::test_alpine_table -v

# Re-authenticate Gmail (if token expired or scopes changed)
python -m agent.auth_setup
```

## Architecture

The system is an email-driven shipment tracker with three layers:

**1. Agent (`agent/`)** — the core Python service, runs on GitHub Actions every hour.

- `main.py` — entrypoint. Queries Gmail with multiple search strings, deduplicates threads, routes each message by type to a handler block, upserts to SQLite, then syncs to Supabase and Google Sheets.
- `gmail_client.py` — Gmail API wrapper. `get_message_body()` returns HTML; `get_message_text()` returns plain text (needed for GreenFruit plain-text emails).
- `db.py` — SQLite layer. The upsert rule **never overwrites a non-null value with null**. The primary key for deduplication is `lookup_key = cliente_norm|unit_id_norm|po_norm`.
- `normalizers.py` — all string normalization (unit IDs, POs, dates, commodity synonyms, client aliases). Pure functions, no side effects.
- `business_rules.py` — fumigation logic, `calc_dia_disponible()` (cutoff-hour rule), `calc_reinspection_due_date()` (Altar TX 4-day rule), `calc_ready_for_inspection()`.
- `supabase_sync.py` — full upsert of all SQLite rows into Supabase each run. Supabase is a read-only replica; SQLite is the source of truth.
- `notifications.py` — WhatsApp (Twilio) + email (Gmail API) alerts for `ready_for_inspection`, `report_received`, `reinspection_due`, `eta_overdue` events. Deduplication is one notification per (shipment_id, event_type) per calendar day.
- `claude_client.py` — Anthropic Haiku calls: `map_headers()` maps raw email table column headers to canonical field names (result is cached in SQLite `header_mapping_cache`); `parse_comments()` extracts warehouse arrival confirmation and fumigation status from free-text comment cells.

**2. Parsers (`agent/parsers/`)** — each returns a list of dicts with canonical field names.

- `ocean.py` — parses HTML tables from Ocean Report / Ocean Update / Air Arrival emails. Handles Alpine Fresh, Prime Time, Altar Produce, Robinson Fresh table layouts.
- `inspection_report.py` — parses emails from `reports@eliteqa.app`. Subject format: `CLIENT - COMMODITY - CONTAINER - PO | OVERALL GRADE`.
- `prime_time_pl.py` — parses Prime Time packing list emails (subject `PM-XXXXX`) to link PO → container.
- `greenfruit.py` — parses GreenFruit arrival emails from `andrew@greenfruitavocados.com` and `ops@elitequalityassurance.com`. Three body formats: A (container/PO pairs), C (shipper–container arriving-on-date), B (bare container list after vessel/ETA header).

**3. Web dashboard (`web/`)** — Next.js + Tailwind app, reads from Supabase. Not deployed by the agent; deployed separately. Uses Supabase Realtime on the `notifications` table for live toast alerts.

## Email routing in `main.py`

`_classify_message()` determines email type in this priority order:
1. `from:reports@eliteqa.app` → `inspection_report`
2. Subject contains `OCEAN REPORT` or `OCEAN UPDATE` → `ocean_update`
3. Subject contains `AIR ARRIVAL` → `air_arrival` ⚠️ Alpine emails usan "AIR ARRIVALS" (con S) — revisar si el match funciona
4. Subject contains `SQ1` + `INSPECTION REQUEST` → `sq1_receiving_card`
5. `pl_parser.is_prime_time_pl(subject)` → `prime_time_pl`
6. `gf_parser.is_greenfruit_sender(sender, subject, to_cc)` → `greenfruit_arrival`

## Configuration

`config/clients.yaml` — canonical client registry. Each entry has `display_name`, `aliases` (for resolving client names from email subjects/bodies), `subject_patterns` (for `detect_client_from_subject()`), `cutoff_hour` (used by `calc_dia_disponible`), `location`, and `known_modes`.

`config/fumigation_rules.yaml` — commodity + country combinations that require fumigation.

## Data flow

```
Gmail → gmail_client → parser → normalizers → db.upsert_shipment
                                             → business_rules (derived fields)
                                             → notifications.check_and_notify
                                             → supabase_sync.sync
                                             → sheets_sync.sync
```

At the end of every run, all open shipments are reprocessed through `calc_dia_disponible` and `calc_reinspection_due_date` (dates shift as today changes).

## Stateless GitHub Actions runs

The agent runs stateless (no persistent disk). At startup it calls `supabase_sync.restore_processed_messages()` and `restore_shipments()` to pull existing state from Supabase into the fresh SQLite file. This prevents re-processing already-seen emails.

Required GitHub Secrets: `GMAIL_TOKEN_JSON`, `ANTHROPIC_API_KEY`, `SHEET_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `NOTIFY_WHATSAPP`, `NOTIFY_EMAILS`.

## Schema changes

Always update both `schema.sql` (SQLite) and `supabase_schema.sql` (PostgreSQL) together, then create a numbered migration in `migrations/` for running on the live Supabase instance.
