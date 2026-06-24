"""
Parser for Inspection Report emails from reports@eliteqa.app.

Subject format:
    Inspection Report — {Commodity} | PO {PO} | {Container} | {Client} | {City} | {Shipper}

All key fields can be extracted from the subject alone.
The HTML body is parsed for: overall_grade, report_date, pallets, report_url.

Container can be:
  - A standard container number:  BMOU9892595
  - A container with spaces/dashes:  SEKU 942442-5  (normalize to SEKU9424425)
  - An AWB number:  406-00458820  (normalize)
  - "DELIVERY"  → unit_id = None (terrestrial load)
  - Empty       → unit_id = None
"""
import re
import logging
from typing import Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

SENDER = 'reports@eliteqa.app'
_SUBJECT_PREFIX = 'Inspection Report — '
_INVALID_UNIT_IDS = {'DELIVERY', 'N/A', 'NA', 'TBD', 'TBC'}


def is_inspection_report(sender: str, subject: str) -> bool:
    return SENDER in (sender or '').lower()


def parse_subject(subject: str) -> Optional[dict]:
    """
    Parse the subject line. Returns a dict with keys:
        commodity, po, po_norm, unit_id, unit_id_norm, cliente_raw,
        city, shipper
    or None if the subject doesn't match the expected format.
    """
    if not subject.startswith(_SUBJECT_PREFIX):
        return None

    rest = subject[len(_SUBJECT_PREFIX):]
    parts = [p.strip() for p in rest.split('|')]

    if len(parts) < 2:
        return None

    commodity_raw = parts[0].strip() if len(parts) > 0 else None

    po_part = parts[1].strip() if len(parts) > 1 else ''
    po_match = re.match(r'^PO\s+(.+)$', po_part, re.IGNORECASE)
    po_raw = po_match.group(1).strip() if po_match else po_part or None

    container_raw = parts[2].strip() if len(parts) > 2 else ''
    cliente_raw   = parts[3].strip() if len(parts) > 3 else None
    city          = parts[4].strip() if len(parts) > 4 else None
    shipper       = parts[5].strip() if len(parts) > 5 else None

    # Normalize unit_id: strip spaces, dashes, uppercase; reject DELIVERY/empty
    unit_id_norm: Optional[str] = None
    if container_raw:
        cleaned = re.sub(r'[\s\-\t]', '', container_raw).upper()
        if cleaned and cleaned not in _INVALID_UNIT_IDS:
            unit_id_norm = cleaned

    # Normalize PO: reject placeholder values
    _PO_PLACEHOLDERS = {'PO', 'N/A', 'NA', 'TBD', ''}
    po_norm: Optional[str] = None
    if po_raw:
        po_upper = po_raw.strip().upper()
        if po_upper not in _PO_PLACEHOLDERS:
            po_norm = po_upper

    return {
        'commodity_raw': commodity_raw,
        'po':            po_raw,
        'po_norm':       po_norm,
        'unit_id':       container_raw if unit_id_norm else None,
        'unit_id_norm':  unit_id_norm,
        'cliente_raw':   cliente_raw,
        'city':          city,
        'shipper':       shipper,
    }


def parse_html(html_body: str) -> dict:
    """
    Extract overall_grade, report_date, pallets, report_url from the HTML body.
    All fields are optional — returns empty dict if nothing found.
    """
    if not html_body:
        return {}

    soup = BeautifulSoup(html_body, 'lxml')
    text = soup.get_text(separator='\n')
    result: dict = {}

    # Overall Grade: pattern "C/2" or "B/3" or "A/1"
    grade_m = re.search(r'Overall Grade\s*\n\s*([A-Z]/\d)', text)
    if grade_m:
        result['overall_grade'] = grade_m.group(1)
    else:
        # Fallback: look for pattern anywhere
        grade_m2 = re.search(r'\b([A-Z]/[1-4])\b', text)
        if grade_m2:
            result['overall_grade'] = grade_m2.group(1)

    # Condition and Quality labels (e.g., "C\nFair" or "B\nGood")
    cond_m = re.search(r'Condition\s*\n\s*([A-Z])\s*\n\s*(\w+)', text)
    if cond_m:
        result['condition_text'] = f"{cond_m.group(1)} {cond_m.group(2)}"

    quality_m = re.search(r'Quality\s*\n\s*(\d)\s*\n\s*(\w+)', text)
    if quality_m:
        result['quality_text'] = f"{quality_m.group(1)} {quality_m.group(2)}"

    # Arrival Date: "06/20/2026"
    arrival_m = re.search(r'Arrival Date\s*\n\s*(\d{2}/\d{2}/\d{4})', text)
    if arrival_m:
        result['report_date'] = arrival_m.group(1)

    # Pallets
    pallets_m = re.search(r'Pallets\s*\n\s*(\d+)', text)
    if pallets_m:
        result['pallets'] = int(pallets_m.group(1))

    # Report URL (View Full Report link)
    link = soup.find('a', string=re.compile(r'View Full Report', re.IGNORECASE))
    if link and link.get('href'):
        result['report_url'] = link['href']

    return result
