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
    'sq1_receiving_card', 'prime_time_pl', 'greenfruit_arrival', or 'unknown'."""
    sender  = _get_msg_header(msg, 'From').lower()
    subject = _get_msg_header(msg, 'Subject')
    subject_upper = subject.upper()
    to_cc   = (_get_msg_header(msg, 'To') + ' ' + _get_msg_header(msg, 'Cc')).lower()

    if ir_parser.SENDER in sender:
        return 'inspection_report'
    if 'OCEAN REPORT' in subject_upper or 'OCEAN UPDATE' in subject_upper:
        return 'ocean_update'
    if 'AIR ARRIVAL' in subject_upper:
        return 'air_arrival'
    if 'SQ1' in subject_upper and 'INSPECTION REQUEST' in subject_upper:
        return 'sq1_receiving_card'
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


def _get_client_location(cliente: str, clients_config: dict) -> Optional[str]:
    """Return the default location for a client from config (e.g. 'Miami', 'Texas')."""
    for _key, cfg in clients_config.items():
        if cfg['display_name'].lower() == cliente.lower():
            return cfg.get('location')
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
    args = parser.parse_args()

    clients_config, fum_rules = load_config()

    db_path = _require_env('DB_PATH')
    conn    = db_mod.init_db(db_path)

    # In stateless environments (GitHub Actions), restore processed_messages
    # from Supabase so we don't re-process emails from previous runs
    sb_url = os.environ.get('SUPABASE_URL', '')
    sb_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if sb_url and sb_key and not args.dry_run:
        supabase_sync.restore_processed_messages(conn, sb_url, sb_key)
        supabase_sync.restore_shipments(conn, sb_url, sb_key)

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
        'subject:"AIR ARRIVALS" newer_than:7d',
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

    threads = _collect_threads(service, [ocean_query, air_query, sq1_query, ir_query, pl_query, gf_query])
    logger.info('Total unique threads: %d', len(threads))

    stats = {
        'threads': len(threads),
        'messages_seen': 0,
        'messages_skipped': 0,
        'ocean_rows_inserted': 0,
        'ocean_rows_updated': 0,
        'inspection_inserted': 0,
        'inspection_updated': 0,
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
                        saved = conn.execute(
                            'SELECT * FROM shipments WHERE cliente_norm=? AND (unit_id_norm=? OR po_norm=?)',
                            (record['cliente_norm'], record.get('unit_id_norm'), record.get('po_norm')),
                        ).fetchone()
                        if saved:
                            derived = {}
                            dia = business_rules.calc_dia_disponible(dict(saved), clients_config)
                            if dia:
                                derived['dia_disponible_para_inspeccion'] = dia
                            reinsp = business_rules.calc_reinspection_due_date(dict(saved), clients_config)
                            if reinsp:
                                derived['reinspection_due_date'] = reinsp
                            if derived:
                                db_mod.update_derived_fields(conn, saved['id'], derived)
                            notif.check_and_notify(dict(saved), prev, conn, service)

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

                        saved = conn.execute(
                            'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
                            (record['cliente_norm'], record['unit_id_norm']),
                        ).fetchone()
                        if saved:
                            derived = {}
                            dia = business_rules.calc_dia_disponible(dict(saved), clients_config)
                            if dia:
                                derived['dia_disponible_para_inspeccion'] = dia
                            reinsp = business_rules.calc_reinspection_due_date(dict(saved), clients_config)
                            if reinsp:
                                derived['reinspection_due_date'] = reinsp
                            if derived:
                                db_mod.update_derived_fields(conn, saved['id'], derived)
                            notif.check_and_notify(dict(saved), prev, conn, service)

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

                        saved = conn.execute(
                            'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
                            (record['cliente_norm'], record['unit_id_norm']),
                        ).fetchone()
                        if saved:
                            derived = {}
                            dia = business_rules.calc_dia_disponible(dict(saved), clients_config)
                            if dia:
                                derived['dia_disponible_para_inspeccion'] = dia
                            reinsp = business_rules.calc_reinspection_due_date(dict(saved), clients_config)
                            if reinsp:
                                derived['reinspection_due_date'] = reinsp
                            if derived:
                                db_mod.update_derived_fields(conn, saved['id'], derived)
                            notif.check_and_notify(dict(saved), prev, conn, service)

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
                    sq1_location     = _get_client_location('Square One', clients_config)

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
                            'location':                 sq1_location,
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

                        saved = conn.execute(
                            'SELECT * FROM shipments WHERE cliente_norm=? AND po_norm=?',
                            (sq1_cliente_norm, po_norm),
                        ).fetchone()
                        if saved:
                            derived: dict = {}
                            dia_disp = business_rules.calc_dia_disponible(dict(saved), clients_config)
                            if dia_disp:
                                derived['dia_disponible'] = dia_disp
                            reinsp = business_rules.calc_reinspection_due_date(dict(saved))
                            if reinsp:
                                derived['reinspection_due_date'] = reinsp
                            if derived:
                                db_mod.update_derived_fields(conn, saved['id'], derived)
                            notif.check_and_notify(dict(saved), prev, conn, service)

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

                    saved = conn.execute(
                        'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
                        (record['cliente_norm'], unit_id_norm),
                    ).fetchone()
                    if saved:
                        derived: dict = {}
                        dia = business_rules.calc_dia_disponible(dict(saved), clients_config)
                        if dia:
                            derived['dia_disponible_para_inspeccion'] = dia
                        reinsp = business_rules.calc_reinspection_due_date(dict(saved), clients_config)
                        if reinsp:
                            derived['reinspection_due_date'] = reinsp
                        if derived:
                            db_mod.update_derived_fields(conn, saved['id'], derived)
                        notif.check_and_notify(dict(saved), prev, conn, service)

            else:
                logger.debug('Unknown email type for message %s (subject: %r)', message_id, subject)
                stats['rows_skipped'] += 1


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

                    saved = conn.execute(
                        'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
                        (record['cliente_norm'], unit_id_norm),
                    ).fetchone()
                    if saved:
                        derived: dict = {}
                        dia_disp = business_rules.calc_dia_disponible(dict(saved), clients_config)
                        if dia_disp:
                            derived['dia_disponible'] = dia_disp
                        reinsp = business_rules.calc_reinspection_due_date(dict(saved))
                        if reinsp:
                            derived['reinspection_due_date'] = reinsp
                        if derived:
                            db_mod.update_derived_fields(conn, saved['id'], derived)
                        notif.check_and_notify(dict(saved), prev, conn, service)

            if not args.dry_run:
                db_mod.mark_processed(conn, message_id, thread_id)
                conn.commit()

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
        'ocean_ins=%d ocean_upd=%d ir_ins=%d ir_upd=%d rows_skip=%d',
        stats['threads'], stats['messages_seen'], stats['messages_skipped'],
        stats['ocean_rows_inserted'], stats['ocean_rows_updated'],
        stats['inspection_inserted'], stats['inspection_updated'],
        stats['rows_skipped'],
    )


if __name__ == '__main__':
    main()
