"""
Sunkist vessel-announcement thread parser.

721 Logistics announces some Sunkist vessels with a growing reply-all thread,
subject "<VESSEL> - SUNKIST GLOBAL - <COMMODITY> - ETA <M/D>" (confirmed
07/2026: Seaboard Verde, HSL Nike, BSG Bahamas — only 3 of the ~15 vessels
in a given Container Status report get this treatment, so it's a
*complement* to sunkist_status.py, never a substitute for it).

Body is an HTML table:
  CONTAINER# | COMMODITY | TRUCKER | FDA | CBP | WHSE | DELIVERY
e.g. "CAIU5678287 | Lemons | PRO Transport | Released | Pre-Cleared |
      ACL Miami | Monday 07/06"

Why this is worth parsing in addition to the xlsx: DELIVERY is a firm
warehouse-delivery date confirmed in advance by the trucker/broker — more
precise than the vessel ETA the xlsx falls back on. Real example: the xlsx
snapshot before HSL Nike's arrival showed eta_fecha=2026-07-05 (the vessel's
port ETA), but this thread's DELIVERY column already said "Monday 07/06" —
a full day later. We use DELIVERY to correct eta_fecha (the field
business_rules.calc_dia_disponible falls back on) rather than leaving the
less-accurate vessel ETA in place.
"""
import logging
import re
from datetime import datetime
from typing import Optional

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_SUBJECT_RE = re.compile(
    r'^(?:RE:\s*)?(?P<vessel>.+?)\s*-\s*SUNKIST GLOBAL\s*-\s*(?P<commodity>.+?)\s*-\s*ETA\s*(?P<eta>\d{1,2}/\d{1,2})',
    re.IGNORECASE,
)

_DELIVERY_DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})')

# Header cell -> canonical field. Matched case-insensitively after stripping.
_HEADER_MAP = {
    'container#': 'unit_id',
    'commodity': 'commodity_raw',
    'trucker': 'trucker',
    'fda': 'fda_status',
    'cbp': 'customs_status',
    'whse': 'warehouse',
    'delivery': 'delivery_raw',
}


def parse_subject(subject: str) -> Optional[dict]:
    """Extract {'vessel', 'commodity', 'eta_fecha'} from the subject line."""
    m = _SUBJECT_RE.match((subject or '').strip())
    if not m:
        return None
    month, day = m.group('eta').split('/')
    year = datetime.now().year
    try:
        eta_fecha = f'{year:04d}-{int(month):02d}-{int(day):02d}'
    except ValueError:
        eta_fecha = None
    return {
        'vessel': m.group('vessel').strip(),
        'commodity': m.group('commodity').strip(),
        'eta_fecha': eta_fecha,
    }


def is_sunkist_vessel(subject: str) -> bool:
    return parse_subject(subject) is not None


def _delivery_date(raw: Optional[str]) -> Optional[str]:
    """'Monday 07/06' -> 'YYYY-MM-DD' (assumes current year, same convention
    as sunkist_status.py's event dates and fresh_way.py/sq1.py's ETAs)."""
    if not raw:
        return None
    m = _DELIVERY_DATE_RE.search(raw)
    if not m:
        return None
    month, day = m.groups()
    year = datetime.now().year
    try:
        return f'{year:04d}-{int(month):02d}-{int(day):02d}'
    except ValueError:
        return None


def parse_html(html: str) -> list[dict]:
    """
    Parse the CONTAINER#/COMMODITY/TRUCKER/FDA/CBP/WHSE/DELIVERY table.

    Returns one dict per container:
        {unit_id, commodity_raw, trucker, fda_status, customs_status,
         warehouse, delivery_date}
    """
    if not html:
        return []
    soup = BeautifulSoup(html, 'lxml')
    table = soup.find('table')
    if table is None:
        return []

    rows = table.find_all('tr')
    if not rows:
        return []

    header_cells = [c.get_text(strip=True).lower() for c in rows[0].find_all(['td', 'th'])]
    col_fields = [_HEADER_MAP.get(h) for h in header_cells]
    if 'unit_id' not in col_fields:
        logger.warning('Sunkist vessel thread: no CONTAINER# column found in table')
        return []

    records: list[dict] = []
    for row in rows[1:]:
        cells = [c.get_text(strip=True) for c in row.find_all('td')]
        if len(cells) != len(col_fields):
            continue
        rec = {field: cell for field, cell in zip(col_fields, cells) if field}
        if not rec.get('unit_id'):
            continue
        rec['delivery_date'] = _delivery_date(rec.pop('delivery_raw', None))
        records.append(rec)

    return records
