#!/usr/bin/env python3
"""
Inspection Agent — Multi-client, multi-email-type.

Cron entrypoint: reads Gmail, routes emails to the correct parser,
consolidates shipment state in SQLite, syncs to Google Sheets.

Supported email types:
  - Ocean Report / Ocean Update (HTML table with green or gray header)
  - Inspection Report from reports@eliteqa.app (structured subject + HTML)

Usage:
    python -m agent.main
    python -m agent.main --dry-run
    python -m agent.main --since-hours 2
"""
import argparse
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml
from anthropic import Anthropic
from dotenv import load_dotenv

from agent import gmail_client, db as db_mod, sheets_sync, supabase_sync, normalizers, claude_client, business_rules
from agent import notifications as notif
from agent.parsers import ocean as ocean_parser
from agent.parsers import inspection_report as ir_parser
from agent.parsers import prime_time_pl as pl_parser
from agent.parsers import greenfruit as gf_parser
from agent.parsers import sq1 as sq1_parser
from agent.parsers import fresh_way as fw_parser
from agent.parsers import altar_lot as altar_lot_parser
from agent.parsers import alpine_lot as alpine_lot_parser
from agent.parsers import sunkist_status as sunkist_parser
from agent.parsers import sunkist_vessel as sunkist_vessel_parser

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger('main')


def load_config() -> tuple[dict, list[dict]]:
    config_dir = Path(__file__).parent.parent / 'config'
    with open(config_dir / 'clients.yaml') as f:
        clients = yaml.safe_load(f)
    with open(config_dir / 'fumigation_rules.yaml') as f:
        fum_rules = yaml.safe_load(f).get('rules', [])
    return clients, fum_rules


def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        logger.error('Required environment variable %s is not set', key)
        sys.exit(1)
    return val


def _get_msg_header(msg: dict, name: str) -> str:
    """Extract a header value from a Gmail message dict."""
    headers = msg.get('payload', {}).get('headers', [])
    for h in headers:
        if h.get('name', '').lower() == name.lower():
            return h.get('value', '')
    return ''


def _classify_message(msg: dict) -> str:
    """Return 'ocean_update', 'air_arrival', 'inspection_report',
    'sq1_receiving_card', 'prime_time_pl', 'greenfruit_arrival',
    'fresh_way_request', 'altar_lot', 'alpine_lot', 'sunkist_status',
    'sunkist_vessel', 'quality_alert', or 'unknown'."""
    sender  = _get_msg_header(msg, 'From').lower()
    subject = _get_msg_header(msg, 'Subject')
    subject_upper = subject.upper()
    to_cc   = (_get_msg_header(msg, 'To') + ' ' + _get_msg_header(msg, 'Cc')).lower()

    if ir_parser.SENDER in sender:
        # Quality Alerts share the sender but aren't shipment reports —
        # ignore explicitly instead of failing subject parsing every run.
        if 'QUALITY ALERT' in subject_upper:
            return 'quality_alert'
        return 'inspection_report'
    if 'OCEAN REPORT' in subject_upper or 'OCEAN UPDATE' in subject_upper:
        return 'ocean_update'
    # "AIR ARRIVALS" (Alpine via Alba) and "AIR UPDATE" (Prime Time via ACB)
    if 'AIR ARRIVAL' in subject_upper or 'AIR UPDATE' in subject_upper:
        return 'air_arrival'
    if 'SQ1' in subject_upper and 'INSPECTION REQUEST' in subject_upper:
        return 'sq1_receiving_card'
    if fw_parser.is_inspection_request(subject):
        return 'fresh_way_request'
    if altar_lot_parser.is_altar_lot(subject, sender):
        return 'altar_lot'
    if alpine_lot_parser.is_alpine_lot(subject, sender):
        return 'alpine_lot'
    if sunkist_parser.is_sunkist_status(subject):
        return 'sunkist_status'
    if sunkist_vessel_parser.is_sunkist_vessel(subject):
        return 'sunkist_vessel'
    if pl_parser.is_prime_time_pl(subject):
        return 'prime_time_pl'
    if gf_parser.is_greenfruit_sender(sender, subject, to_cc):
        return 'greenfruit_arrival'
    return 'unknown'


def _parse_int(s: Optional[str]) -> Optional[int]:
    try:
        return int(s) if s else None
    except (ValueError, TypeError):
        return None


def compute_auto_window_hours(last_processed_iso: Optional[str],
                              now: Optional[datetime] = None) -> int:
    """
    Adaptive Gmail search window: hours since the last processed email plus a
    2h margin, clamped to [4h, 14 days]. Self-healing: after an outage the
    next run automatically widens to cover the gap instead of skipping it
    (a fixed --since-hours 4 permanently lost any email older than 4h after
    the 36h outage of 07/2026). No history / unparseable → widest window.
    """
    min_h, max_h, margin_h = 4, 14 * 24, 2
    if not last_processed_iso:
        return max_h
    try:
        last = datetime.fromisoformat(str(last_processed_iso).replace('Z', '+00:00'))
    except ValueError:
        return max_h
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    now = now or datetime.now(timezone.utc)
    gap_h = max(0.0, (now - last).total_seconds() / 3600)
    return int(min(max_h, max(min_h, gap_h + margin_h)))


def _get_client_location(cliente: str, clients_config: dict) -> Optional[str]:
    """Return the default location for a client from config (e.g. 'Miami', 'Texas').

    In clients.yaml, `location` can be a string or a list. A list means the
    client operates in multiple ports; ocean/air table rows carry no per-shipment
    location signal, so we can't tell which one a given row belongs to. Join
    them into one display string rather than dropping the field to NULL — a
    filed-but-ambiguous location is more useful downstream (dashboard/agenda
    grouping) than a silently missing one.
    (Returning the raw list crashes the SQLite bind: 'type list is not supported'.)
    """
    for _key, cfg in clients_config.items():
        if cfg['display_name'].lower() == cliente.lower():
            loc = cfg.get('location')
            if isinstance(loc, str):
                return loc
            if isinstance(loc, list) and loc:
                return ' / '.join(loc)
            return None
    return None


def _fetch_shipment(conn, cliente_norm: str, unit_id_norm: Optional[str],
                    po_norm: Optional[str]) -> Optional[dict]:
    """Fetch current shipment row before upsert (for change detection)."""
    if unit_id_norm:
        row = conn.execute(
            'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
            (cliente_norm, unit_id_norm),
        ).fetchone()
        if row:
            return dict(row)
    if po_norm:
        row = conn.execute(
            'SELECT * FROM shipments WHERE cliente_norm=? AND po_norm=?',
            (cliente_norm, po_norm),
        ).fetchone()
        if row:
            return dict(row)
    return None


def _finalize_after_upsert(
    conn,
    cliente_norm: str,
    unit_id_norm: Optional[str],
    po_norm: Optional[str],
    prev: Optional[dict],
    clients_config: dict,
    service,
) -> None:
    """Post-upsert bookkeeping shared by every email type:
    re-fetch the saved row, recompute derived fields, and fire notifications."""
    saved = None
    if unit_id_norm:
        saved = conn.execute(
            'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
            (cliente_norm, unit_id_norm),
        ).fetchone()
    if saved is None and po_norm:
        saved = conn.execute(
            'SELECT * FROM shipments WHERE cliente_norm=? AND po_norm=?',
            (cliente_norm, po_norm),
        ).fetchone()
    if not saved:
        return

    s = dict(saved)
    derived: dict = {}
    dia = business_rules.calc_dia_disponible(s, clients_config)
    if dia:
        derived['dia_disponible_para_inspeccion'] = dia
    reinsp = business_rules.calc_reinspection_due_date(s, clients_config)
    if reinsp:
        derived['reinspection_due_date'] = reinsp
    if derived:
        db_mod.update_derived_fields(conn, s['id'], derived)
    notif.check_and_notify(s, prev, conn, service)


def build_record_from_ocean_row(
    raw_row: dict,
    field_mapping: dict,
    cliente: str,
    thread_id: str,
    message_id: str,
    message_date_iso: Optional[str],
    fum_rules: list[dict],
    anthropic_client: Anthropic,
    tipo_carga: str = 'ocean',
    clients_config: Optional[dict] = None,
) -> Optional[dict]:
    """Convert one parsed ocean table row into a canonical shipment record."""
    mapped: dict = {}
    for raw_header, canonical_field in field_mapping.items():
        if canonical_field and raw_header in raw_row:
            mapped[canonical_field] = raw_row[raw_header]

    # unit_id is required for ocean updates
    unit_id_raw  = mapped.get('unit_id')
    unit_id_norm = normalizers.normalize_unit_id(unit_id_raw)
    if not unit_id_norm:
        logger.warning('Ocean row has no valid unit_id — skipping. row=%s', raw_row)
        return None

    # Country: try mapped field first (Altar Produce has a CO column), then extract from shipper
    shipper_raw  = mapped.get('shipper') or ''
    country      = mapped.get('country_of_origin') or normalizers.extract_country_from_shipper(shipper_raw)
    shipper_name = normalizers.extract_shipper_name(shipper_raw)

    # Commodity: try mapped field first (Altar Produce has COMMODITY column),
    # then extract from "QUANTITY & DESCRIPTION" cell (Alpine Fresh format)
    commodity_norm = (
        normalizers.normalize_commodity(mapped.get('commodity'))
        or normalizers.extract_commodity_from_description(mapped.get('quantity_description'))
    )

    # BL number (Altar Produce has BL NO column)
    bl = mapped.get('bl')

    # COMMENTS → warehouse_arrival + fumigation via Claude Haiku
    comments_raw = mapped.get('comments_raw') or ''
    parsed_comments: dict = {}
    if comments_raw.strip():
        parsed_comments = claude_client.parse_comments(comments_raw, anthropic_client)

    # Fumigation logic
    fum_status_raw = mapped.get('fumigation_status') or ''
    req_fum = business_rules.requires_fumigation(
        commodity_norm, country, fum_status_raw, fum_rules
    )
    fum_completed = (
        business_rules.fumigation_is_completed(fum_status_raw)
        or parsed_comments.get('fumigation_confirmed', False)
    )
    fum_completed_at: Optional[str] = message_date_iso if fum_completed else None

    wh_confirmed = bool(parsed_comments.get('warehouse_arrival_confirmed', False))
    wh_at        = normalizers.normalize_date(parsed_comments.get('warehouse_arrival_at'))

    cliente_norm = normalizers.normalize_client_name(cliente)

    po_raw  = mapped.get('po')
    po_norm = normalizers.normalize_po(po_raw)

    record: dict = {
        'cliente':                  cliente,
        'cliente_norm':             cliente_norm,
        'tipo_carga':               tipo_carga,
        'unit_id':                  unit_id_raw,
        'unit_id_norm':             unit_id_norm,
        'po':                       po_raw,
        'po_norm':                  po_norm,
        'shipper':                  shipper_name,
        'country_of_origin':        country,
        'commodity':                commodity_norm,
        'eta_fecha':                normalizers.normalize_date(mapped.get('eta_fecha')),
        'vessel':                   mapped.get('vessel'),
        'carrier':                  mapped.get('carrier'),
        'bl':                       bl,
        'fda_status':               mapped.get('fda_status'),
        'customs_status':           mapped.get('customs_status'),
        'agriculture_usda_status':  mapped.get('agriculture_usda_status'),
        'fumigation_status':        fum_status_raw or None,
        'fumigation_completed_at':  fum_completed_at,
        'warehouse_arrival_confirmed': int(wh_confirmed),
        'warehouse_arrival_at':     wh_at,
        'requiere_fumigacion':      int(req_fum),
        'quantity_description':     mapped.get('quantity_description') or None,
        'pallets':                  _parse_int(mapped.get('pallets')),
        'comments_raw':             comments_raw or None,
        'psi_file':                 mapped.get('psi_file'),
        'location':                 _get_client_location(cliente, clients_config or {}),
        'fuente':                   f'{thread_id}:{message_id}',
    }

    record['ready_for_inspection'] = int(
        business_rules.calc_ready_for_inspection(record, {})
    )
    return record


def build_record_from_inspection_report(
    subject: str,
    html: str,
    thread_id: str,
    message_id: str,
    message_date_iso: Optional[str],
    clients_config: dict,
) -> Optional[dict]:
    """Build a shipment record from an inspection report email."""
    parsed_subject = ir_parser.parse_subject(subject)
    if not parsed_subject:
        logger.warning('Could not parse inspection report subject: %s', subject)
        return None

    cliente_raw = parsed_subject.get('cliente_raw') or ''

    # Resolve client name via aliases
    cliente = normalizers.normalize_client(cliente_raw, clients_config)
    if not cliente:
        # Try detect_client_from_subject as fallback using the client part of subject
        cliente = normalizers.detect_client_from_subject(cliente_raw, clients_config)
    if not cliente:
        # Last resort: use the raw name from subject
        cliente = cliente_raw.strip() or 'UNKNOWN'
        logger.warning('Unrecognized client in inspection report: %r', cliente_raw)

    cliente_norm = normalizers.normalize_client_name(cliente)

    unit_id_norm = parsed_subject.get('unit_id_norm')
    po_norm      = parsed_subject.get('po_norm')

    # Need at least unit_id or po to store the record
    if not unit_id_norm and not po_norm:
        logger.warning('Inspection report has no unit_id and no PO — skipping. subject=%s', subject)
        return None

    parsed_html = ir_parser.parse_html(html) if html else {}

    # Normalize report_date from HTML (MM/DD/YYYY → YYYY-MM-DD)
    report_date_raw = parsed_html.get('report_date')
    report_date     = normalizers.normalize_date(report_date_raw)

    record: dict = {
        'cliente':          cliente,
        'cliente_norm':     cliente_norm,
        'tipo_carga':       'ocean',   # Carrier field from HTML is more accurate but complex
        'unit_id':          parsed_subject.get('unit_id'),
        'unit_id_norm':     unit_id_norm,
        'po':               parsed_subject.get('po'),
        'po_norm':          po_norm,
        'shipper':          parsed_subject.get('shipper'),
        'commodity':        normalizers.normalize_commodity(parsed_subject.get('commodity_raw')),
        'overall_grade':    parsed_html.get('overall_grade'),
        'condition_text':   parsed_html.get('condition_text'),
        'quality_text':     parsed_html.get('quality_text'),
        'pallets':          parsed_html.get('pallets'),
        'report_date':      report_date,
        'report_url':       parsed_html.get('report_url'),
        'report_sent':      1,
        'inspection_status': 'completada',
        'warehouse_arrival_confirmed': 1,
        'warehouse_arrival_at': report_date or message_date_iso,
        'ready_for_inspection': 1,
        'estado_general':   'cerrado',
        'location':         _get_client_location(cliente, clients_config),
        'fuente':           f'{thread_id}:{message_id}',
    }
    return record


def _collect_threads(service, queries: list[str]) -> list[dict]:
    """Run multiple Gmail queries and deduplicate threads by id."""
    seen: set[str] = set()
    threads: list[dict] = []
    for q in queries:
        if not q:
            continue
        batch = gmail_client.list_threads(service, q)
        for t in batch:
            if t['id'] not in seen:
                seen.add(t['id'])
                threads.append(t)
    return threads


def main() -> None:
    parser = argparse.ArgumentParser(description='Inspection Agent — Multi-client')
    parser.add_argument('--dry-run', action='store_true',
                        help='Parse and log without writing to DB or Sheets')
    parser.add_argument('--since-hours', type=int, default=None,
                        help='Restrict Gmail search to last N hours')
    parser.add_argument('--auto-window', action='store_true',
                        help='Size the Gmail window from the last processed email '
                             'in Supabase (self-healing after outages)')
    args = parser.parse_args()

    clients_config, fum_rules = load_config()

    db_path = _require_env('DB_PATH')
    conn    = db_mod.init_db(db_path)

    # In stateless environments (GitHub Actions), restore processed_messages
    # from Supabase so we don't re-process emails from previous runs
    sb_url = os.environ.get('SUPABASE_URL', '')
    sb_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if sb_url and sb_key and not args.dry_run:
        restored_msgs  = supabase_sync.restore_processed_messages(conn, sb_url, sb_key)
        restored_ships = supabase_sync.restore_shipments(conn, sb_url, sb_key)
        # Fail fast: sin estado restaurado, la corrida reprocesaría TODO desde
        # cero (minutos de Haiku al vacío) y el sync final fallaría igual —
        # mejor abortar ya, marcar el run como failure y que suene la alerta.
        # (Pasó el 07/03/26: SERVICE_ROLE_KEY vencida → 401 → "success" mentiroso.)
        if restored_msgs < 0 or restored_ships < 0:
            logger.error('Supabase inaccesible (¿SERVICE_ROLE_KEY vencida?) — abortando')
            sys.exit(1)

    if args.auto_window and args.since_hours is None and sb_url and sb_key:
        last = supabase_sync.last_processed_at(sb_url, sb_key)
        args.since_hours = compute_auto_window_hours(last)
        logger.info('Auto window: last processed %s → --since-hours %d',
                    last or 'never', args.since_hours)

    gmail_token = _require_env('GMAIL_TOKEN_FILE')
    service     = gmail_client.build_service(gmail_token)

    anthropic = Anthropic(api_key=_require_env('ANTHROPIC_API_KEY'))

    def _apply_time_window(q: str) -> str:
        if args.since_hours:
            q = re.sub(r'newer_than:\S+', '', q).strip()
            q += f' newer_than:{args.since_hours}h'
        return q

    ocean_query = _apply_time_window(os.environ.get(
        'OCEAN_UPDATE_QUERY',
        '(subject:"OCEAN REPORT" OR subject:"OCEAN UPDATE") newer_than:7d',
    ))
    ir_query = _apply_time_window(os.environ.get(
        'INSPECTION_REPORT_QUERY',
        'from:reports@eliteqa.app newer_than:7d',
    ))
    air_query = _apply_time_window(os.environ.get(
        'AIR_ARRIVALS_QUERY',
        '(subject:"AIR ARRIVALS" OR subject:"AIR UPDATE") newer_than:7d',
    ))
    fw_query = _apply_time_window(os.environ.get(
        'FRESH_WAY_REQUEST_QUERY',
        'subject:INSPECCION newer_than:14d',
    ))
    altar_lot_query = _apply_time_window(os.environ.get(
        'ALTAR_LOT_QUERY',
        # Domain-based, not a specific person's address — is_altar_lot() already
        # scopes to altarproduce.com + the "LOT // CONTAINER" subject pattern,
        # so any sender at that domain should be fetched, not just Melissa's.
        'from:@altarproduce.com newer_than:14d',
    ))
    alpine_lot_query = _apply_time_window(os.environ.get(
        'ALPINE_LOT_QUERY',
        # Carlos Gallo announces Alpine LA lots; domain-wide for the same reason.
        'from:@alpinefresh.com subject:LOT newer_than:14d',
    ))
    sunkist_status_query = _apply_time_window(os.environ.get(
        'SUNKIST_STATUS_QUERY',
        'subject:"Sunkist Container Status" newer_than:3d',
    ))
    sunkist_vessel_query = _apply_time_window(os.environ.get(
        'SUNKIST_VESSEL_QUERY',
        # Only 3 of ~15 vessels per Container Status report get one of these
        # threads (confirmed 07/2026) — this is a complement, not a substitute.
        'subject:"SUNKIST GLOBAL" subject:"ETA" newer_than:14d',
    ))
    sq1_query = _apply_time_window(os.environ.get(
        'SQ1_RECEIVING_CARD_QUERY',
        'subject:"SQ1 Inspection Request" newer_than:30d',
    ))
    pl_query = _apply_time_window(os.environ.get(
        'PRIME_TIME_PL_QUERY',
        'subject:PM- newer_than:30d',
    ))
    gf_query = _apply_time_window(os.environ.get(
        'GREENFRUIT_QUERY',
        '(from:andrew@greenfruitavocados.com OR subject:"UPCOMING LOADS") newer_than:30d',
    ))

    logger.info('Ocean query: %s', ocean_query)
    logger.info('Air arrivals query: %s', air_query)
    logger.info('Inspection report query: %s', ir_query)
    logger.info('Prime Time PL query: %s', pl_query)
    logger.info('GreenFruit query: %s', gf_query)
    logger.info('Fresh Way request query: %s', fw_query)
    logger.info('Altar lot query: %s', altar_lot_query)
    logger.info('Alpine lot query: %s', alpine_lot_query)
    logger.info('Sunkist status query: %s', sunkist_status_query)
    logger.info('Sunkist vessel query: %s', sunkist_vessel_query)

    threads = _collect_threads(service, [
        ocean_query, air_query, sq1_query, ir_query,
        pl_query, gf_query, fw_query, altar_lot_query, alpine_lot_query,
        sunkist_status_query, sunkist_vessel_query,
    ])
    logger.info('Total unique threads: %d', len(threads))

    stats = {
        'threads': len(threads),
        'messages_seen': 0,
        'messages_skipped': 0,
        'ocean_rows_inserted': 0,
        'ocean_rows_updated': 0,
        'inspection_inserted': 0,
        'inspection_updated': 0,
        'rows_inserted': 0,
        'rows_updated': 0,
        'rows_skipped': 0,
    }

    for thread_meta in threads:
        thread   = gmail_client.get_thread(service, thread_meta['id'])
        messages = sorted(
            thread.get('messages', []),
            key=lambda m: int(m.get('internalDate', 0)),
        )

        for msg in messages:
            message_id = msg['id']
            thread_id  = msg['threadId']
            stats['messages_seen'] += 1

            if db_mod.is_processed(conn, message_id):
                stats['messages_skipped'] += 1
                logger.debug('Already processed %s — skipping', message_id)
                continue

            try:
                email_type    = _classify_message(msg)
                message_date  = gmail_client.get_message_date(msg)
                subject       = _get_msg_header(msg, 'Subject')

                if email_type == 'inspection_report':
                    html = gmail_client.get_message_body(msg)
                    record = build_record_from_inspection_report(
                        subject, html, thread_id, message_id, message_date, clients_config,
                    )
                    if record is None:
                        stats['rows_skipped'] += 1
                    else:
                        # Square One attaches a PDF with lots to review
                        if record.get('cliente') == 'Square One':
                            attachments = gmail_client.get_attachments(service, msg)
                            for att in attachments:
                                lots = claude_client.extract_lots_from_pdf(att['data'], anthropic)
                                if lots:
                                    record['lots_raw'] = lots
                                    logger.info('Extracted lots from PDF for %s / %s',
                                                record.get('cliente'), record.get('po'))
                                    break

                        if args.dry_run:
                            logger.info('[DRY-RUN] Inspection report: client=%s po=%s container=%s grade=%s lots=%s',
                                        record.get('cliente'), record.get('po'),
                                        record.get('unit_id'), record.get('overall_grade'),
                                        record.get('lots_raw', '')[:60] or '—')
                            stats['inspection_inserted'] += 1
                        else:
                            prev = _fetch_shipment(conn, record['cliente_norm'],
                                                   record.get('unit_id_norm'), record.get('po_norm'))
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                stats['inspection_inserted'] += 1
                            else:
                                stats['inspection_updated'] += 1

                            # After upsert, recalculate derived fields for this shipment
                            _finalize_after_upsert(
                                conn, record['cliente_norm'],
                                record.get('unit_id_norm'), record.get('po_norm'),
                                prev, clients_config, service,
                            )

                elif email_type == 'ocean_update':
                    # Detect client from subject
                    cliente = normalizers.detect_client_from_subject(subject, clients_config)
                    if not cliente:
                        logger.warning('Could not detect client from subject: %r — skipping', subject)
                        stats['rows_skipped'] += 1
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    html = gmail_client.get_message_body(msg)
                    if not html:
                        logger.warning('No HTML body in message %s', message_id)
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    raw_rows = ocean_parser.parse(html)
                    if not raw_rows:
                        logger.warning('No rows parsed from message %s (subject: %s)', message_id, subject)
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    headers      = [h for h in raw_rows[0].keys() if h is not None]
                    field_mapping = claude_client.map_headers(headers, conn, anthropic)

                    for raw_row in raw_rows:
                        record = build_record_from_ocean_row(
                            raw_row, field_mapping, cliente,
                            thread_id, message_id, message_date, fum_rules, anthropic,
                            clients_config=clients_config,
                        )
                        if record is None:
                            stats['rows_skipped'] += 1
                            continue

                        if args.dry_run:
                            logger.info('[DRY-RUN] Ocean upsert %s / %s: %s',
                                        record.get('cliente'), record.get('unit_id_norm'),
                                        {k: v for k, v in record.items() if v is not None})
                            stats['ocean_rows_inserted'] += 1
                        else:
                            prev = _fetch_shipment(conn, record['cliente_norm'],
                                                   record.get('unit_id_norm'), record.get('po_norm'))
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                stats['ocean_rows_inserted'] += 1
                            else:
                                stats['ocean_rows_updated'] += 1

                            _finalize_after_upsert(
                                conn, record['cliente_norm'],
                                record['unit_id_norm'], record.get('po_norm'),
                                prev, clients_config, service,
                            )

                elif email_type == 'air_arrival':
                    cliente = normalizers.detect_client_from_subject(subject, clients_config)
                    if not cliente:
                        logger.warning('Air arrival: could not detect client from subject: %r — skipping', subject)
                        stats['rows_skipped'] += 1
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    html = gmail_client.get_message_body(msg)
                    if not html:
                        logger.warning('No HTML body in air arrival message %s', message_id)
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    raw_rows = ocean_parser.parse(html)
                    if not raw_rows:
                        logger.warning('No rows parsed from air arrival message %s (subject: %s)', message_id, subject)
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    headers = [h for h in raw_rows[0].keys() if h is not None]
                    field_mapping = claude_client.map_headers(headers, conn, anthropic)

                    for raw_row in raw_rows:
                        record = build_record_from_ocean_row(
                            raw_row, field_mapping, cliente,
                            thread_id, message_id, message_date, fum_rules, anthropic,
                            tipo_carga='air',
                            clients_config=clients_config,
                        )
                        if record is None:
                            stats['rows_skipped'] += 1
                            continue

                        if args.dry_run:
                            logger.info('[DRY-RUN] Air arrival upsert %s / %s: %s',
                                        record.get('cliente'), record.get('unit_id_norm'),
                                        {k: v for k, v in record.items() if v is not None})
                            stats['ocean_rows_inserted'] += 1
                        else:
                            prev = _fetch_shipment(conn, record['cliente_norm'],
                                                   record.get('unit_id_norm'), record.get('po_norm'))
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                stats['ocean_rows_inserted'] += 1
                            else:
                                stats['ocean_rows_updated'] += 1

                            _finalize_after_upsert(
                                conn, record['cliente_norm'],
                                record['unit_id_norm'], record.get('po_norm'),
                                prev, clients_config, service,
                            )

                elif email_type == 'sq1_receiving_card':
                    # ── 1. Parse lot IDs from subject + body ─────────────────────
                    body_text = gmail_client.get_message_text(msg) or gmail_client.get_message_body(msg) or ''
                    sq1_rows = sq1_parser.parse(subject, body_text)

                    pdf_lot_norms: set[str] = set()

                    # ── 2. Also handle legacy PDF "RECEIVING CARD" attachments ───
                    attachments = gmail_client.get_attachments(service, msg)
                    pdfs = [a for a in attachments if a['mime_type'] == 'application/pdf']
                    for att in pdfs:
                        fn_match = re.search(
                            r'RECEIVING\s+CARD\s+(.+?)(?:\s+REVISED)?\.pdf',
                            att['filename'], re.IGNORECASE,
                        )
                        if not fn_match:
                            logger.warning('SQ1: could not parse lot from PDF filename: %s', att['filename'])
                            continue
                        lot_raw = fn_match.group(1).strip()
                        po_norm = normalizers.normalize_po(lot_raw)
                        pdf_lot_norms.add(po_norm)

                        lots_json = claude_client.extract_lots_from_pdf(att['data'], anthropic)
                        if not lots_json:
                            logger.warning('SQ1: could not extract lots from %s', att['filename'])
                            continue

                        if args.dry_run:
                            logger.info('[DRY-RUN] SQ1 PDF: lot=%s po_norm=%s lots=%s',
                                        lot_raw, po_norm, lots_json[:80])
                        else:
                            conn.execute(
                                "UPDATE shipments SET lots_raw=? WHERE po_norm=? AND cliente_norm='SQUARE ONE'",
                                (lots_json, po_norm),
                            )
                            conn.commit()

                    # ── 3. Upsert a shipment record for every lot found ──────────
                    if not sq1_rows:
                        logger.warning('SQ1: no lots parsed from message %s (subject: %r)',
                                       message_id, subject)
                    else:
                        sq1_cliente_norm = normalizers.normalize_client_name('Square One')

                        for sq1_row in sq1_rows:
                            lot_id  = sq1_row['lot_id']
                            po_norm = normalizers.normalize_po(lot_id)

                            unit_id      = sq1_row.get('unit_id')
                            unit_id_norm = normalizers.normalize_unit_id(unit_id) if unit_id else None

                            record: dict = {
                                'cliente':                  'Square One',
                                'cliente_norm':             sq1_cliente_norm,
                                'tipo_carga':               'terrestre',
                                'po':                       lot_id,
                                'po_norm':                  po_norm,
                                'unit_id':                  unit_id_norm,
                                'unit_id_norm':             unit_id_norm,
                                'eta_fecha':                sq1_row.get('eta_fecha'),
                                'warehouse_arrival_confirmed': 1,
                                'ready_for_inspection':     1,
                                # Per-request port: Transkool subjects → Texas (McAllen),
                                # Angelica's warehouse arrivals → Miami (see sq1.py).
                                'location':                 sq1_row.get('location'),
                                'fuente':                   f'{thread_id}:{message_id}',
                            }

                            if args.dry_run:
                                logger.info('[DRY-RUN] SQ1: lot=%s container=%s eta=%s',
                                            lot_id, unit_id_norm, sq1_row.get('eta_fecha'))
                                stats['rows_inserted'] += 1
                                continue

                            prev   = _fetch_shipment(conn, sq1_cliente_norm, unit_id_norm, po_norm)
                            result = db_mod.upsert_shipment(conn, record)
                            conn.commit()

                            if result == 'inserted':
                                stats['rows_inserted'] += 1
                                logger.info('SQ1: inserted lot %s (container=%s eta=%s)',
                                            lot_id, unit_id_norm, sq1_row.get('eta_fecha'))
                            else:
                                stats['rows_updated'] += 1
                                logger.info('SQ1: updated lot %s', lot_id)

                            _finalize_after_upsert(
                                conn, sq1_cliente_norm,
                                unit_id_norm, po_norm,
                                prev, clients_config, service,
                            )

                elif email_type == 'prime_time_pl':
                    parsed_subj = pl_parser.parse_subject(subject)
                    if not parsed_subj:
                        logger.warning('prime_time_pl: could not parse subject: %r', subject)
                        stats['rows_skipped'] += 1
                    else:
                        html = gmail_client.get_message_body(msg)
                        parsed_body = pl_parser.parse_html(html or '')

                        unit_id_norm = parsed_body.get('unit_id_norm')
                        po_norm      = parsed_subj['po_norm']
                        po           = parsed_subj['po']
                        cliente_norm = normalizers.normalize_client_name('Prime Time')

                        commodity_raw = parsed_body.get('commodity_raw')

                        record: dict = {
                            'cliente':       'Prime Time',
                            'cliente_norm':  cliente_norm,
                            'tipo_carga':    'ocean',
                            'po':            po,
                            'po_norm':       po_norm,
                            'unit_id':       unit_id_norm,
                            'unit_id_norm':  unit_id_norm,
                            'lots_raw':      parsed_body.get('lots_raw'),
                            'location':      _get_client_location('Prime Time', clients_config),
                            'fuente':        f'{thread_id}:{message_id}',
                        }
                        if commodity_raw:
                            record['commodity'] = normalizers.normalize_commodity(commodity_raw)

                        if args.dry_run:
                            logger.info('[DRY-RUN] Prime Time PL: pl=%s container=%s', po_norm, unit_id_norm or '?')
                            stats['ocean_rows_updated'] += 1
                        else:
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                logger.info('Prime Time PL: inserted new row for %s (no matching ocean update yet)', po_norm)
                                stats['ocean_rows_inserted'] += 1
                            else:
                                logger.info('Prime Time PL: linked %s → container %s', po_norm, unit_id_norm or '?')
                                stats['ocean_rows_updated'] += 1

                elif email_type == 'greenfruit_arrival':
                    # Prefer plain text; fall back to HTML (parser handles both)
                    body = gmail_client.get_message_text(msg) or gmail_client.get_message_body(msg) or ''
                    if not body:
                        logger.warning('GreenFruit: no body in message %s', message_id)
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    gf_rows = gf_parser.parse(body, subject)
                    if not gf_rows:
                        logger.warning('GreenFruit parser: no rows from message %s (subject: %s)',
                                       message_id, subject)
                        if not args.dry_run:
                            db_mod.mark_processed(conn, message_id, thread_id)
                            conn.commit()
                        continue

                    for gf_row in gf_rows:
                        unit_id_norm = normalizers.normalize_unit_id(gf_row.get('unit_id'))
                        if not unit_id_norm:
                            logger.warning('GreenFruit row missing unit_id — skipping. row=%s', gf_row)
                            stats['rows_skipped'] += 1
                            continue

                        po_raw  = gf_row.get('po')
                        po_norm = normalizers.normalize_po(po_raw)

                        country     = gf_row.get('country_of_origin')
                        shipper_raw = gf_row.get('shipper')

                        record: dict = {
                            'cliente':          'GreenFruit',
                            'cliente_norm':     normalizers.normalize_client_name('GreenFruit'),
                            'tipo_carga':       'ocean',
                            'unit_id':          unit_id_norm,
                            'unit_id_norm':     unit_id_norm,
                            'po':               po_raw,
                            'po_norm':          po_norm,
                            'shipper':          shipper_raw,
                            'country_of_origin': country,
                            'commodity':        'Avocado',
                            'eta_fecha':        gf_row.get('eta_fecha'),
                            'vessel':           gf_row.get('vessel'),
                            'location':         _get_client_location('GreenFruit', clients_config),
                            'fuente':           f'{thread_id}:{message_id}',
                        }

                        if args.dry_run:
                            logger.info('[DRY-RUN] GreenFruit: container=%s po=%s eta=%s vessel=%s country=%s',
                                        unit_id_norm, po_raw, gf_row.get('eta_fecha'),
                                        gf_row.get('vessel'), country)
                            stats['ocean_rows_inserted'] += 1
                            continue

                        prev   = _fetch_shipment(conn, record['cliente_norm'],
                                                 unit_id_norm, po_norm)
                        result = db_mod.upsert_shipment(conn, record)
                        if result == 'inserted':
                            stats['ocean_rows_inserted'] += 1
                        else:
                            stats['ocean_rows_updated'] += 1

                        _finalize_after_upsert(
                            conn, record['cliente_norm'],
                            unit_id_norm, po_norm,
                            prev, clients_config, service,
                        )

                elif email_type == 'fresh_way_request':
                    body = gmail_client.get_message_text(msg) or gmail_client.get_message_body(msg) or ''
                    fw = fw_parser.parse(subject, body)
                    if not fw:
                        logger.warning('Fresh Way request: could not parse subject: %r', subject)
                        stats['rows_skipped'] += 1
                    else:
                        fw_cliente_norm = normalizers.normalize_client_name('Fresh Way')
                        detected_location = fw.get('location')
                        location = detected_location or _get_client_location('Fresh Way', clients_config)
                        # Texas lots arrive by truck (DELIVERY); Miami lots are typically air.
                        # Only apply this heuristic when the body actually named a location —
                        # an undetected location (e.g. VEGLAND lots with no location keyword,
                        # see fresh_way.py docstring) must not be silently guessed as 'air';
                        # fall back to the schema's neutral 'ocean' default instead.
                        loc_lower = (detected_location or '').lower()
                        if loc_lower == 'texas':
                            tipo = 'terrestre'
                        elif loc_lower:
                            tipo = 'air'
                        else:
                            tipo = 'ocean'
                            logger.warning(
                                'Fresh Way lot %s: no location detected in body — '
                                'defaulting tipo_carga to ocean', fw['lot_id'],
                            )

                        record: dict = {
                            'cliente':       'Fresh Way',
                            'cliente_norm':  fw_cliente_norm,
                            'tipo_carga':    tipo,
                            'po':            fw['lot_id'],
                            'po_norm':       normalizers.normalize_po(fw['lot_id']),
                            'commodity':     normalizers.normalize_commodity(fw.get('commodity_raw')),
                            'eta_fecha':     fw.get('eta_fecha'),
                            'location':      location,
                            # Ancla para la alerta la_request_overdue: llegada a
                            # bodega si el email la trae, si no la fecha del request.
                            'dia_disponible_para_inspeccion':
                                fw.get('eta_fecha') or (message_date or '')[:10] or None,
                            'comments_raw':  f"Solicitud de inspección — bodega {fw['warehouse']}",
                            'fuente':        f'{thread_id}:{message_id}',
                        }

                        if args.dry_run:
                            logger.info('[DRY-RUN] Fresh Way request: lot=%s commodity=%s eta=%s warehouse=%s',
                                        fw['lot_id'], fw.get('commodity_raw'),
                                        fw.get('eta_fecha'), fw['warehouse'])
                            stats['rows_inserted'] += 1
                        else:
                            prev   = _fetch_shipment(conn, fw_cliente_norm, None, record['po_norm'])
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                stats['rows_inserted'] += 1
                            else:
                                stats['rows_updated'] += 1
                            _finalize_after_upsert(
                                conn, fw_cliente_norm, None, record['po_norm'],
                                prev, clients_config, service,
                            )

                elif email_type == 'altar_lot':
                    parsed = altar_lot_parser.parse_subject(subject)
                    if not parsed:
                        logger.warning('Altar lot: could not parse subject: %r', subject)
                        stats['rows_skipped'] += 1
                    else:
                        unit_id_norm = normalizers.normalize_unit_id(parsed['unit_id'])
                        po_norm      = normalizers.normalize_po(parsed['po'])
                        altar_norm   = normalizers.normalize_client_name('Altar Produce')

                        record: dict = {
                            'cliente':      'Altar Produce',
                            'cliente_norm': altar_norm,
                            'tipo_carga':   'ocean',
                            'po':           parsed['po'],
                            'po_norm':      po_norm,
                            'unit_id':      parsed['unit_id'],
                            'unit_id_norm': unit_id_norm,
                            'commodity':    'Asparagus',
                            'location':     _get_client_location('Altar Produce', clients_config),
                            'fuente':       f'{thread_id}:{message_id}',
                        }

                        if args.dry_run:
                            logger.info('[DRY-RUN] Altar lot: po=%s container=%s', po_norm, unit_id_norm)
                            stats['rows_inserted'] += 1
                        else:
                            prev   = _fetch_shipment(conn, altar_norm, unit_id_norm, po_norm)
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                logger.info('Altar lot: inserted %s (container %s)', po_norm, unit_id_norm)
                                stats['rows_inserted'] += 1
                            else:
                                logger.info('Altar lot: linked %s → container %s', po_norm, unit_id_norm)
                                stats['rows_updated'] += 1

                            _finalize_after_upsert(
                                conn, altar_norm, unit_id_norm, po_norm,
                                prev, clients_config, service,
                            )

                elif email_type == 'alpine_lot':
                    parsed = alpine_lot_parser.parse_subject(subject)
                    if not parsed:
                        logger.warning('Alpine lot: could not parse subject: %r', subject)
                        stats['rows_skipped'] += 1
                    else:
                        # po stored as "92364//CARRIL011" so the inspection report
                        # (which uses that combined format) merges into this row.
                        po_combined = parsed['po_combined']
                        po_norm     = normalizers.normalize_po(po_combined)
                        alpine_norm = normalizers.normalize_client_name('Alpine Fresh')

                        record: dict = {
                            'cliente':      'Alpine Fresh',
                            'cliente_norm': alpine_norm,
                            'tipo_carga':   'air',
                            'po':           po_combined,
                            'po_norm':      po_norm,
                            'commodity':    'Asparagus',
                            'location':     'Los Angeles',
                            'ready_for_inspection': 1,
                            # Fecha del request de Carlos: ancla para la alerta de
                            # 2 días sin inspeccionar (alpine_la_overdue) y para la agenda.
                            'dia_disponible_para_inspeccion': (message_date or '')[:10] or None,
                            'comments_raw': f"Solicitud de Carlos Gallo — LOT {parsed['lot']} en LCX Fresh (LAX)",
                            'fuente':       f'{thread_id}:{message_id}',
                        }

                        if args.dry_run:
                            logger.info('[DRY-RUN] Alpine lot: po=%s lot=%s', po_norm, parsed['lot'])
                            stats['rows_inserted'] += 1
                        else:
                            prev   = _fetch_shipment(conn, alpine_norm, None, po_norm)
                            result = db_mod.upsert_shipment(conn, record)
                            if result == 'inserted':
                                logger.info('Alpine lot: inserted %s (Los Angeles)', po_norm)
                                stats['rows_inserted'] += 1
                            else:
                                logger.info('Alpine lot: updated %s', po_norm)
                                stats['rows_updated'] += 1

                            _finalize_after_upsert(
                                conn, alpine_norm, None, po_norm,
                                prev, clients_config, service,
                            )

                elif email_type == 'sunkist_status':
                    attachments = gmail_client.get_attachments(
                        service, msg,
                        mime_types=(
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        ),
                    )
                    if not attachments:
                        logger.warning('Sunkist status: no xlsx attachment in message %s', message_id)
                        stats['rows_skipped'] += 1
                    else:
                        sunkist_norm = normalizers.normalize_client_name('Sunkist')
                        containers = sunkist_parser.parse_xlsx(attachments[0]['data'])
                        if not containers:
                            stats['rows_skipped'] += 1

                        for c in containers:
                            unit_id_norm = normalizers.normalize_unit_id(c['unit_id'])
                            po_norm = normalizers.normalize_po(c['entry_no']) if c['entry_no'] else None
                            if not unit_id_norm:
                                stats['rows_skipped'] += 1
                                continue

                            commodity_norm = normalizers.normalize_commodity(c['commodity_raw'])
                            req_fum = business_rules.requires_fumigation(
                                commodity_norm, c['origin'], None, fum_rules,
                            )

                            record: dict = {
                                'cliente':                     'Sunkist',
                                'cliente_norm':                sunkist_norm,
                                # Every row in this feed has a Vessel (it's part of the
                                # master-row filter in sunkist_status.parse_xlsx) — this
                                # is exclusively ocean cargo. "ACL AIRPORT" is just the
                                # name of the destination clearance facility, confirmed
                                # against real Seaboard Verde / HSL Nike vessel data —
                                # it does NOT mean the container flew in.
                                'tipo_carga':                  'ocean',
                                'po':                          c['entry_no'],
                                'po_norm':                     po_norm,
                                'unit_id':                     c['unit_id'],
                                'unit_id_norm':                unit_id_norm,
                                'commodity':                   commodity_norm,
                                'country_of_origin':           c['origin'],
                                'vessel':                      c['vessel'],
                                'bl':                          c['bill_of_lading'],
                                'eta_fecha':                   c['eta_fecha'],
                                # Store the feed's own warehouse name rather than
                                # guessing a Miami/Texas/LA bucket — Manfredi Cold
                                # Storage vs. Manfredi Pedricktown is ambiguous and
                                # not worth mis-locating a shipment over.
                                'location':                    c['warehouse'].title() if c['warehouse'] else None,
                                'requiere_fumigacion':         int(req_fum),
                                'warehouse_arrival_confirmed': int(c['warehouse_arrival_confirmed']),
                                'warehouse_arrival_at':        c['warehouse_arrival_at'],
                                'comments_raw':                c['latest_event'],
                                'fuente':                      f'{thread_id}:{message_id}',
                            }
                            record['ready_for_inspection'] = int(
                                business_rules.calc_ready_for_inspection(record, clients_config)
                            )

                            if args.dry_run:
                                logger.info(
                                    '[DRY-RUN] Sunkist: entry=%s container=%s gate_in=%s',
                                    c['entry_no'], c['unit_id'], c['warehouse_arrival_confirmed'],
                                )
                                stats['rows_inserted'] += 1
                            else:
                                prev   = _fetch_shipment(conn, sunkist_norm, unit_id_norm, po_norm)
                                result = db_mod.upsert_shipment(conn, record)
                                if result == 'inserted':
                                    stats['rows_inserted'] += 1
                                else:
                                    stats['rows_updated'] += 1

                                _finalize_after_upsert(
                                    conn, sunkist_norm, unit_id_norm, po_norm,
                                    prev, clients_config, service,
                                )

                elif email_type == 'sunkist_vessel':
                    parsed_subj = sunkist_vessel_parser.parse_subject(subject)
                    html = gmail_client.get_message_body(msg)
                    rows = sunkist_vessel_parser.parse_html(html or '')
                    if not rows:
                        stats['rows_skipped'] += 1
                    else:
                        sunkist_norm = normalizers.normalize_client_name('Sunkist')
                        for row in rows:
                            unit_id_norm = normalizers.normalize_unit_id(row['unit_id'])
                            if not unit_id_norm:
                                stats['rows_skipped'] += 1
                                continue

                            # This thread never has an Entry# (po) — enrich with
                            # whatever the xlsx already set for this container so
                            # the upsert merges into that row instead of creating
                            # a duplicate with an empty po part of the lookup_key.
                            existing_po = conn.execute(
                                'SELECT po, po_norm FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
                                (sunkist_norm, unit_id_norm),
                            ).fetchone()
                            po      = existing_po['po'] if existing_po else None
                            po_norm = existing_po['po_norm'] if existing_po else None

                            commodity_norm = normalizers.normalize_commodity(row.get('commodity_raw'))
                            delivery_date  = row.get('delivery_date')

                            record: dict = {
                                'cliente':          'Sunkist',
                                'cliente_norm':     sunkist_norm,
                                'tipo_carga':        'ocean',
                                'po':                po,
                                'po_norm':           po_norm,
                                'unit_id':           row['unit_id'],
                                'unit_id_norm':      unit_id_norm,
                                'commodity':         commodity_norm,
                                'vessel':            parsed_subj['vessel'] if parsed_subj else None,
                                'location':          row.get('warehouse'),
                                'fda_status':        row.get('fda_status'),
                                'customs_status':    row.get('customs_status'),
                                # DELIVERY is a firm warehouse-delivery date the
                                # trucker/broker confirms in advance — more precise
                                # than the vessel ETA the xlsx falls back on, so it
                                # overrides eta_fecha (what calc_dia_disponible reads).
                                'eta_fecha':         delivery_date or (parsed_subj['eta_fecha'] if parsed_subj else None),
                                'comments_raw':      f"Trucker: {row['trucker']}" if row.get('trucker') else None,
                                'fuente':            f'{thread_id}:{message_id}',
                            }

                            if args.dry_run:
                                logger.info(
                                    '[DRY-RUN] Sunkist vessel: container=%s delivery=%s',
                                    row['unit_id'], delivery_date,
                                )
                                stats['rows_inserted'] += 1
                            else:
                                prev   = _fetch_shipment(conn, sunkist_norm, unit_id_norm, po_norm)
                                result = db_mod.upsert_shipment(conn, record)
                                if result == 'inserted':
                                    stats['rows_inserted'] += 1
                                else:
                                    stats['rows_updated'] += 1

                                _finalize_after_upsert(
                                    conn, sunkist_norm, unit_id_norm, po_norm,
                                    prev, clients_config, service,
                                )

                elif email_type == 'quality_alert':
                    # Same sender as inspection reports but not a shipment record —
                    # mark processed silently so it stops generating parse warnings.
                    logger.debug('Quality alert (ignored): %s', subject)

                else:
                    logger.debug('Unknown email type for message %s (subject: %r)', message_id, subject)
                    stats['rows_skipped'] += 1

                if not args.dry_run:
                    db_mod.mark_processed(conn, message_id, thread_id)
                    conn.commit()
            except Exception as exc:
                logger.exception(
                    'Error processing message %s (thread %s): %s',
                    message_id, thread_id, exc,
                )
                stats['rows_skipped'] += 1
                try:
                    conn.rollback()
                except Exception:
                    pass
                continue

    # Recompute derived fields for ALL open shipments every run
    # (ensures dia_disponible_para_inspeccion is always fresh in Supabase,
    #  even for shipments whose emails were processed in a previous run)
    if not args.dry_run:
        open_shipments = conn.execute(
            "SELECT * FROM shipments WHERE estado_general = 'abierto'"
        ).fetchall()
        for row in open_shipments:
            s = dict(row)
            derived: dict = {}
            dia = business_rules.calc_dia_disponible(s, clients_config)
            if dia and dia != s.get('dia_disponible_para_inspeccion'):
                derived['dia_disponible_para_inspeccion'] = dia
            reinsp = business_rules.calc_reinspection_due_date(s, clients_config)
            if reinsp and reinsp != s.get('reinspection_due_date'):
                derived['reinspection_due_date'] = reinsp
            if derived:
                db_mod.update_derived_fields(conn, s['id'], derived)
            notif.check_and_notify(s, None, conn, service)
        conn.commit()

    # Sync to Sheets + Supabase (non-fatal)
    if not args.dry_run:
        sheet_id   = os.environ.get('SHEET_ID', '')
        token_file = os.environ.get('GMAIL_TOKEN_FILE', '')
        if sheet_id and token_file and os.path.exists(token_file):
            written = sheets_sync.sync(conn, sheet_id, token_file)
            logger.info('Sheets sync: %d rows written', written)
        else:
            logger.warning('Sheets sync skipped — SHEET_ID or token file not configured')

        sb_url = os.environ.get('SUPABASE_URL', '')
        sb_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
        if sb_url and sb_key:
            synced = supabase_sync.sync(conn, sb_url, sb_key)
            if synced < 0:
                logger.error('Supabase sync falló — el dashboard quedó desactualizado; '
                             'marcando la corrida como failure')
                conn.close()
                sys.exit(1)
            supabase_sync.sync_processed_messages(conn, sb_url, sb_key)
            logger.info('Supabase sync: %d rows upserted', synced)
            # Directly recompute derived fields in Supabase for ALL open shipments,
            # including those not touched in this run (stateless runner has empty SQLite)
            supabase_sync.recompute_derived_fields_in_supabase(sb_url, sb_key, clients_config)
        else:
            logger.warning('Supabase sync skipped — SUPABASE_URL or key not configured')

    conn.close()

    logger.info(
        'Run complete — threads=%d seen=%d skipped=%d '
        'ocean_ins=%d ocean_upd=%d ir_ins=%d ir_upd=%d '
        'sq1_ins=%d sq1_upd=%d rows_skip=%d',
        stats['threads'], stats['messages_seen'], stats['messages_skipped'],
        stats['ocean_rows_inserted'], stats['ocean_rows_updated'],
        stats['inspection_inserted'], stats['inspection_updated'],
        stats['rows_inserted'], stats['rows_updated'],
        stats['rows_skipped'],
    )


if __name__ == '__main__':
    main()
