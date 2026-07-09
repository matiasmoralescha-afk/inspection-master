"""
SQLite storage layer. Single source of truth.

Key design decisions:
- Primary lookup key: generated `lookup_key = cliente_norm|unit_id_norm|po_norm`
  This lets us support Alpine Fresh (no PO), Fresh Way (multi-PO per container),
  and terrestrial loads (no container).
- Upsert rule: never overwrite an existing non-null/non-empty value with null/empty.
- When an inspection report arrives with (container, po) and the prior ocean-update row
  has no po, we find the row by (cliente_norm, unit_id_norm) and update it with the PO.
"""
import sqlite3
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_IMMUTABLE_ON_UPDATE = {'id', 'cliente_norm', 'unit_id_norm', 'lookup_key'}


def init_db(db_path: str) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')

    schema = Path(__file__).parent.parent / 'schema.sql'
    conn.executescript(schema.read_text())
    conn.commit()
    return conn


def _build_lookup_key(cliente_norm: str, unit_id_norm: Optional[str], po_norm: Optional[str]) -> str:
    return f"{cliente_norm}|{unit_id_norm or ''}|{po_norm or ''}"


def _find_existing(conn: sqlite3.Connection, record: dict) -> Optional[sqlite3.Row]:
    """
    Multi-step lookup:
    1. Exact match on all three key fields (handles re-runs and Fresh Way multi-PO).
    2. If this is an inspection report with unit_id+po, also try finding the prior
       ocean-update row that has the same unit_id but no po yet.
    3. If this is a terrestrial load (no unit_id), look up by (cliente, po).
    """
    cliente_norm = record['cliente_norm']
    unit_id_norm = record.get('unit_id_norm')
    po_norm      = record.get('po_norm')

    # 1. Exact lookup
    key = _build_lookup_key(cliente_norm, unit_id_norm, po_norm)
    row = conn.execute('SELECT * FROM shipments WHERE lookup_key=?', (key,)).fetchone()
    if row:
        return row

    # 2. If we have unit_id + po, try finding the ocean-update row without po
    if unit_id_norm and po_norm:
        key_no_po = _build_lookup_key(cliente_norm, unit_id_norm, None)
        row = conn.execute('SELECT * FROM shipments WHERE lookup_key=?', (key_no_po,)).fetchone()
        if row:
            return row

    # 2b. Reverse of step 2: this record has no po yet (e.g. a repeat
    # ocean_update/SQ1 re-confirmation), but a prior row for this container
    # already has one (from altar_lot/inspection_report arriving first —
    # order isn't guaranteed). Only safe when exactly one row exists for
    # this (cliente, unit_id): clients with a real multi-PO-per-container
    # pattern (Fresh Way) must not get silently merged into the wrong PO.
    if unit_id_norm and not po_norm:
        rows = conn.execute(
            'SELECT * FROM shipments WHERE cliente_norm=? AND unit_id_norm=?',
            (cliente_norm, unit_id_norm),
        ).fetchall()
        if len(rows) == 1:
            return rows[0]

    # 3. Terrestrial: no unit_id, has po — look up by (cliente, po)
    if not unit_id_norm and po_norm:
        row = conn.execute(
            'SELECT * FROM shipments WHERE cliente_norm=? AND po_norm=? AND unit_id_norm IS NULL',
            (cliente_norm, po_norm),
        ).fetchone()
        if row:
            return row

    return None


def upsert_shipment(conn: sqlite3.Connection, record: dict) -> str:
    """
    Insert or update a shipment record. Returns 'inserted' or 'updated'.
    Never-overwrite rule: on UPDATE, a field is only changed when the new value
    is not None and not an empty string.
    """
    cliente_norm = record.get('cliente_norm')
    if not cliente_norm:
        raise ValueError(f'Missing cliente_norm in record: {record}')

    now = datetime.now(timezone.utc).isoformat()
    existing = _find_existing(conn, record)

    if existing:
        updates: dict = {'ultima_actualizacion': now}
        if record.get('fuente'):
            updates['fuente'] = record['fuente']

        for field, new_val in record.items():
            if field in _IMMUTABLE_ON_UPDATE:
                continue
            if field in ('ultima_actualizacion', 'fuente'):
                continue
            if new_val is not None and new_val != '':
                updates[field] = new_val

        # Note: `lookup_key` is a STORED GENERATED column (see schema.sql) derived
        # from cliente_norm|unit_id_norm|po_norm, so it recomputes automatically
        # when `po_norm` is filled in here — no manual update needed (and a manual
        # UPDATE would fail: "cannot UPDATE generated column").
        set_clause = ', '.join(f'{k}=?' for k in updates)
        params = list(updates.values()) + [existing['id']]
        conn.execute(f'UPDATE shipments SET {set_clause} WHERE id=?', params)
        logger.debug('Updated shipment id=%d (%s / %s)', existing['id'], cliente_norm,
                     record.get('unit_id_norm'))
        return 'updated'

    # INSERT
    insert_record = {k: v for k, v in record.items() if k != 'lookup_key'}
    insert_record.setdefault('ultima_actualizacion', now)
    insert_record.setdefault('tipo_carga', 'ocean')
    insert_record.setdefault('inspection_status', 'pendiente')
    insert_record.setdefault('report_sent', 0)
    insert_record.setdefault('warehouse_arrival_confirmed', 0)
    insert_record.setdefault('ready_for_inspection', 0)
    insert_record.setdefault('estado_general', 'abierto')

    cols = ', '.join(insert_record.keys())
    placeholders = ', '.join('?' * len(insert_record))
    conn.execute(
        f'INSERT INTO shipments ({cols}) VALUES ({placeholders})',
        list(insert_record.values()),
    )
    logger.debug('Inserted shipment (%s / %s)', cliente_norm, record.get('unit_id_norm'))
    return 'inserted'


def update_derived_fields(conn: sqlite3.Connection, row_id: int, fields: dict) -> None:
    """Update only derived/calculated fields (ready_for_inspection, etc.)."""
    if not fields:
        return
    set_clause = ', '.join(f'{k}=?' for k in fields)
    params = list(fields.values()) + [row_id]
    conn.execute(f'UPDATE shipments SET {set_clause} WHERE id=?', params)


def is_processed(conn: sqlite3.Connection, message_id: str) -> bool:
    row = conn.execute(
        'SELECT 1 FROM processed_messages WHERE message_id=?', (message_id,)
    ).fetchone()
    return row is not None


def mark_processed(conn: sqlite3.Connection, message_id: str, thread_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        'INSERT OR IGNORE INTO processed_messages (message_id, thread_id, processed_at) VALUES (?,?,?)',
        (message_id, thread_id, now),
    )


def get_header_cache(conn: sqlite3.Connection, headers_hash: str) -> Optional[dict]:
    row = conn.execute(
        'SELECT mapping_json FROM header_mapping_cache WHERE headers_hash=?',
        (headers_hash,),
    ).fetchone()
    return json.loads(row['mapping_json']) if row else None


def set_header_cache(conn: sqlite3.Connection, headers_hash: str, mapping: dict) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        'INSERT OR REPLACE INTO header_mapping_cache (headers_hash, mapping_json, created_at)'
        ' VALUES (?,?,?)',
        (headers_hash, json.dumps(mapping), now),
    )


def get_active_shipments(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM shipments WHERE estado_general='abierto'"
        " ORDER BY ready_for_inspection DESC, eta_fecha ASC"
    ).fetchall()
