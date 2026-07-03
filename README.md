# Inspection Master — Elite QA

Agente de gestión de inspecciones para Elite Quality Assurance. Lee Gmail cada hora (GitHub Actions), clasifica y parsea correos de llegadas de carga (ocean, air, terrestre), consolida el estado de cada shipment en SQLite, y sincroniza a Google Sheets y Supabase. Dashboard web en Next.js.

## Arquitectura

```
Gmail ──► agent/main.py (cron horario, GitHub Actions)
              │
              ├─ _classify_message() → tipo de correo
              ├─ parsers/  (ocean, inspection_report, sq1, prime_time_pl, greenfruit)
              ├─ claude_client.py  (Claude Haiku: mapeo de headers, comments, PDFs)
              ├─ business_rules.py (fumigación, ready_for_inspection, fechas derivadas)
              ├─ db.py (SQLite local, deduplicación por message_id)
              │
              ├──► sheets_sync.py   → Google Sheets
              └──► supabase_sync.py → Supabase (fuente para el dashboard)
                                          │
                                          └──► web/ (Next.js + Tailwind)
```

## Tipos de correo soportados

| Tipo | Detección | Cliente |
|---|---|---|
| Ocean Report / Update | subject `OCEAN REPORT` / `OCEAN UPDATE` | Alpine Fresh, Altar Produce, … |
| Air Arrival | subject `AIR ARRIVALS` | varios |
| Inspection Report | from `reports@eliteqa.app` | todos |
| SQ1 Receiving Card | subject `SQ1 Inspection Request` | Square One |
| Prime Time PL | subject `PM-…` | Prime Time |
| GreenFruit Arrival | remitente / `UPCOMING LOADS` | GreenFruit |

## Ejecución local

```bash
pip install -e .
cp .env.example .env   # completar credenciales
python -m agent.main --dry-run            # parsea y loguea sin escribir
python -m agent.main --since-hours 4      # ventana de búsqueda reducida
```

Variables requeridas: `DB_PATH`, `GMAIL_TOKEN_FILE`, `ANTHROPIC_API_KEY`. Opcionales: `SHEET_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Twilio (WhatsApp).

## Tests

```bash
pip install pytest
pytest tests/ -v
```

Incluye `tests/test_smoke.py`, que verifica que todos los módulos del agente compilen — corre también en CI (`.github/workflows/ci.yml`) en cada push, antes de que el código llegue al cron horario.

## Dashboard web

```bash
cd web
npm install
npm run dev
```

Requiere `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Configuración

- `config/clients.yaml` — clientes, aliases, ubicaciones (Miami / LA / Texas), reglas por cliente.
- `config/fumigation_rules.yaml` — reglas de fumigación por commodity + país de origen.
- `schema.sql` / `supabase_schema.sql` — esquema SQLite y Supabase.
- `migrations/` — migraciones incrementales de Supabase.
