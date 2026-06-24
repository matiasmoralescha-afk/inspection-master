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
from agent.parsers import ocean as ocean_parser
from agent.parsers import inspection_report as ir_parser

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
    """Return 'ocean_update', 'air_arrival', 'inspection_report', or 'unknown'."""
    sender  = _get_msg_header(msg, 'From').lower()
    subject = _get_msg_header(msg, 'Subject')
    subject_upper = subject.upper()

    if ir_parser.SENDER in sender:
        return 'inspection_report'
    if 'OCEAN REPORT' in subject_upper or 'OCEAN UPDATE' in subject_upper:
        return 'ocean_update'
    if 'AIR ARRIVAL' in subject_upper:
        return 'air_arrival'
    return 'unknown'


def _parse_int(s: Optional[str]) -> Optional[int]:
    try:
        return int(s) if s else None
    except (ValueError, TypeError):
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

    logger.info('Ocean query: %s', ocean_query)
    logger.info('Air arrivals query: %s', air_query)
    logger.info('Inspection report query: %s', ir_query)

    threads = _collect_threads(service, [ocean_query, air_query, ir_query])
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
                    if args.dry_run:
                        logger.info('[DRY-RUN] Inspection report: client=%s po=%s container=%s grade=%s',
                                    record.get('cliente'), record.get('po'),
                                    record.get('unit_id'), record.get('overall_grade'))
                        stats['inspection_inserted'] += 1
                    else:
                        result = db_mod.upsert_shipment(conn, record)
                        if result == 'inserted':
                            stats['inspection_inserted'] += 1
                        else:
                            stats['inspection_updated'] += 1

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
                            dia = business_rules.calc_dia_disponible(dict(saved), clients_config)
                            if dia:
                                db_mod.update_derived_fields(
                                    conn, saved['id'],
                                    {'dia_disponible_para_inspeccion': dia},
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
                            dia = business_rules.calc_dia_disponible(dict(saved), clients_config)
                            if dia:
                                db_mod.update_derived_fields(
                                    conn, saved['id'],
                                    {'dia_disponible_para_inspeccion': dia},
                                )

            else:
                logger.debug('Unknown email type for message %s (subject: %r)', message_id, subject)
                stats['rows_skipped'] += 1

            if not args.dry_run:
                db_mod.mark_processed(conn, message_id, thread_id)
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
