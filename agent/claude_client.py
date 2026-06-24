"""
Claude API calls — two responsibilities:
1. map_headers: map raw table headers → canonical field names (cached per header-set hash).
2. parse_comments: extract structured info from COMMENTS cell text (per-call, not cached).

Model: claude-haiku-4-5-20251001 for both (fast, cheap).
"""
import json
import hashlib
import logging
import sqlite3
from typing import Optional
from anthropic import Anthropic

from agent import db as db_module

logger = logging.getLogger(__name__)

# All canonical fields the parser might encounter. Used in the Haiku prompt.
_CANONICAL_FIELDS = [
    'unit_id',
    'eta_fecha',
    'eta_hora',
    'shipper',
    'commodity',
    'quantity_description',
    'fda_status',
    'customs_status',          # 10+2 / ISF
    'agriculture_usda_status',
    'fumigation_status',
    'comments_raw',
    'psi_file',
    'vessel',
    'carrier',
]

_MODEL_HAIKU = 'claude-haiku-4-5-20251001'


def _headers_hash(headers: list[str]) -> str:
    key = '|'.join(sorted(h.strip().lower() for h in headers if h))
    return hashlib.md5(key.encode()).hexdigest()


def map_headers(
    headers: list[str],
    conn: sqlite3.Connection,
    client: Anthropic,
) -> dict[str, Optional[str]]:
    """
    Map raw table column headers to canonical field names.
    Result is cached in SQLite by hash of the sorted header set.
    Only calls Claude Haiku when the header combination is new.
    """
    h = _headers_hash(headers)

    cached = db_module.get_header_cache(conn, h)
    if cached is not None:
        logger.debug('Header mapping cache hit for hash %s', h)
        return cached

    logger.info('Header mapping cache miss — calling Claude Haiku (hash %s)', h)
    logger.info('Headers: %s', headers)

    prompt = f"""You are mapping column headers from a shipping status report to canonical field names.

Headers found in this report:
{json.dumps(headers, indent=2)}

Available canonical field names:
{json.dumps(_CANONICAL_FIELDS, indent=2)}

Mapping rules:
- "CONTAINER#", "CONT#", "CONTAINER NO" → unit_id
- "ETA", "ETA DATE", "ESTIMATED ARRIVAL" → eta_fecha
- "SHIPPER", "SHIPPER NAME" → shipper (country in parentheses is extracted separately by code)
- "QUANTITY & DESCRIPTION", "QTY & DESCRIPTION", "DESCRIPTION" → quantity_description (code will extract commodity)
- "FDA STATUS", "FDA" → fda_status
- "10+2", "ISF", "10+2/ISF", "CUSTOMS" → customs_status
- "AGRICULTURE STATUS", "USDA STATUS", "AGRICULTURE", "USDA" → agriculture_usda_status
- "COMMENTS", "COMMENT", "REMARKS", "NOTES" → comments_raw
- "PSI FILE #", "PSI FILE", "PSI#" → psi_file
- "VESSEL NAME/STEAMSHIP LINE/PORT OF ARRIVAL", "VESSEL", "VESSEL/LINE" → vessel
- If a header has no clear canonical match → map to null

Return ONLY a valid JSON object. No explanation, no markdown fences.
Example: {{"ETA": "eta_fecha", "CONTAINER#": "unit_id", "SHIPPER": "shipper", "UNKNOWN COL": null}}"""

    response = client.messages.create(
        model=_MODEL_HAIKU,
        max_tokens=512,
        messages=[{'role': 'user', 'content': prompt}],
    )

    text = response.content[0].text.strip()

    # Strip markdown fences if model includes them
    if '```' in text:
        parts = text.split('```')
        for part in parts:
            stripped = part.lstrip('json').strip()
            if stripped.startswith('{'):
                text = stripped
                break

    try:
        raw_mapping: dict = json.loads(text)
    except json.JSONDecodeError:
        logger.error('Failed to parse Claude header mapping response: %s', text)
        return {h: None for h in headers}

    # Validate — only keep recognized canonical fields (or None)
    validated: dict[str, Optional[str]] = {}
    for header, field in raw_mapping.items():
        if field is None or field in _CANONICAL_FIELDS:
            validated[header] = field
        else:
            logger.warning('Claude returned unknown canonical field "%s" for header "%s" — set to null', field, header)
            validated[header] = None

    db_module.set_header_cache(conn, h, validated)
    conn.commit()

    logger.info('Cached new header mapping: %s', validated)
    return validated


def parse_comments(comments_text: str, client: Anthropic) -> dict:
    """
    Extract structured information from the COMMENTS cell of the Ocean Report.

    Returns:
        {
            "warehouse_arrival_confirmed": bool,
            "warehouse_arrival_at": "YYYY-MM-DD" or None,
            "fumigation_confirmed": bool,
        }

    Section 4.2 / 4.3: only True with explicit confirmation, never with
    pending/scheduled/in-progress states.
    """
    if not comments_text or not comments_text.strip():
        return {
            'warehouse_arrival_confirmed': False,
            'warehouse_arrival_at': None,
            'fumigation_confirmed': False,
        }

    prompt = f"""Extract structured shipping status from this comment text.

Comment: "{comments_text}"

Return ONLY a valid JSON object with exactly these keys:
- "warehouse_arrival_confirmed": true ONLY if the comment explicitly confirms physical delivery to warehouse (e.g. "DELIVERED", "RECEIVED AT WAREHOUSE", "ARRIVED AT FACILITY"). false for anything pending, scheduled, or in-transit.
- "warehouse_arrival_at": date in "YYYY-MM-DD" format if a confirmed delivery date is mentioned, null otherwise.
- "fumigation_confirmed": true ONLY if fumigation is explicitly confirmed as COMPLETED (e.g. "FUMIGATED", "FUMIGATION COMPLETED", "RELEASED FROM FUMIGATION"). false for pending/scheduled/in-progress.

Examples:
- "PENDING DELIVERY CONFIRMATION 06/18/26" → {{"warehouse_arrival_confirmed": false, "warehouse_arrival_at": null, "fumigation_confirmed": false}}
- "DELIVERED" → {{"warehouse_arrival_confirmed": true, "warehouse_arrival_at": null, "fumigation_confirmed": false}}
- "FUMIGATION COMPLETED 06/15/26" → {{"warehouse_arrival_confirmed": false, "warehouse_arrival_at": null, "fumigation_confirmed": true}}
- "FUMIGATED AND DELIVERED 06/17/26" → {{"warehouse_arrival_confirmed": true, "warehouse_arrival_at": "2026-06-17", "fumigation_confirmed": true}}

No explanation. Only JSON."""

    response = client.messages.create(
        model=_MODEL_HAIKU,
        max_tokens=256,
        messages=[{'role': 'user', 'content': prompt}],
    )

    text = response.content[0].text.strip()
    if '```' in text:
        parts = text.split('```')
        for part in parts:
            stripped = part.lstrip('json').strip()
            if stripped.startswith('{'):
                text = stripped
                break

    try:
        result = json.loads(text)
        return {
            'warehouse_arrival_confirmed': bool(result.get('warehouse_arrival_confirmed', False)),
            'warehouse_arrival_at': result.get('warehouse_arrival_at'),
            'fumigation_confirmed': bool(result.get('fumigation_confirmed', False)),
        }
    except (json.JSONDecodeError, AttributeError):
        logger.error('Failed to parse Claude parse_comments response: %s', text)
        return {
            'warehouse_arrival_confirmed': False,
            'warehouse_arrival_at': None,
            'fumigation_confirmed': False,
        }
