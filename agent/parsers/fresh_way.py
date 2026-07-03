"""
Fresh Way inspection-request email parser.

Fresh Way (usualmente nathalia@freshwayusa.com, pero puede escribir cualquier
otra persona — el matching es por asunto, no por remitente) sends direct
inspection requests:

  Subject: "INSPECCION VEGLAND LOT 10120"
  Subject: "INSPECCION 4EARTH LOT 10024"

Body (Spanish, free-form) contains a line with the lot details:

  "10120 DRAGON FRUIT 7/1/2026"
  "10024 LYCHEE 7/8/2026 TEXAS 4EARTH"

We extract: lot id (→ PO), commodity, ETA, and location (Texas/Miami/LA).
The warehouse name comes from the subject (VEGLAND, 4EARTH, ...).
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# "INSPECCION <WAREHOUSE> LOT <ID>" — tolerate accents and RE:/FW: prefixes
_SUBJECT_RE = re.compile(
    r'INSPECCI[OÓ]N\s+([A-Z0-9]+)\s+LOT\s+(\S+)',
    re.IGNORECASE,
)

_LOCATIONS = ['LOS ANGELES', 'TEXAS', 'MIAMI', 'OXNARD', 'NEW JERSEY', 'NEW YORK']

# Bodega → puerto cuando el cuerpo no menciona ubicación (confirmado por ops
# 07/2026: Vegland es la bodega de Los Ángeles).
_WAREHOUSE_LOCATIONS = {'VEGLAND': 'Los Angeles'}

# "<lot> <commodity words> <m/d/yyyy> [location] [warehouse]"
_DETAIL_RE = re.compile(
    r'(?P<lot>[A-Z0-9\-]{3,})\s+'
    r'(?P<commodity>[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ &\-]*?)\s+'
    r'(?P<eta>\d{1,2}/\d{1,2}/\d{2,4})',
    re.IGNORECASE,
)


def is_inspection_request(subject: str) -> bool:
    """Return True for Fresh Way 'INSPECCION <WAREHOUSE> LOT <id>' subjects."""
    return bool(_SUBJECT_RE.search(subject or ''))


def _normalize_eta(raw: str) -> Optional[str]:
    """M/D/YYYY or M/D/YY → YYYY-MM-DD."""
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{2,4})', raw or '')
    if not m:
        return None
    mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yy < 100:
        yy += 2000
    try:
        return f'{yy:04d}-{mm:02d}-{dd:02d}'
    except ValueError:
        return None


def parse(subject: str, body_text: str) -> Optional[dict]:
    """
    Parse a Fresh Way inspection request.

    Returns dict with: lot_id, warehouse, commodity_raw, eta_fecha, location
    (any of the body-derived fields may be None if not found), or None if the
    subject doesn't match.
    """
    m = _SUBJECT_RE.search(subject or '')
    if not m:
        return None

    warehouse = m.group(1).upper()
    lot_id    = m.group(2).strip().upper().rstrip('.,;')

    result: dict = {
        'lot_id':        lot_id,
        'warehouse':     warehouse,
        'commodity_raw': None,
        'eta_fecha':     None,
        'location':      None,
    }

    text = (body_text or '')
    # Prefer the detail line that mentions this exact lot id
    for line in text.splitlines():
        if lot_id in line.upper():
            dm = _DETAIL_RE.search(line)
            if dm and dm.group('lot').upper() == lot_id:
                result['commodity_raw'] = dm.group('commodity').strip().title()
                result['eta_fecha']     = _normalize_eta(dm.group('eta'))
                break

    # Fallback: search the whole body if the line scan found nothing
    if not result['eta_fecha']:
        dm = _DETAIL_RE.search(text)
        if dm and dm.group('lot').upper() == lot_id:
            result['commodity_raw'] = dm.group('commodity').strip().title()
            result['eta_fecha']     = _normalize_eta(dm.group('eta'))

    upper = text.upper()
    for loc in _LOCATIONS:
        if loc in upper:
            result['location'] = loc.title()
            break

    # Fallback: la bodega implica el puerto (ej. VEGLAND → Los Angeles)
    if not result['location']:
        result['location'] = _WAREHOUSE_LOCATIONS.get(warehouse)

    return result
