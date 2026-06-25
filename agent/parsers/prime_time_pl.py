"""
Prime Time Packing List (PL) email parser.

Subject pattern: "PM-E26-042 PL" (or PM-S26-xxx PL, PM-W26-xxx PL, etc.)
  PM   = Prime Time
  E/S/W = season (East/South/West?)
  26   = year
  042  = sequential PL number → this becomes the PO#

The PL email body contains a table with:
  - CONTAINER# (or CONTAINER NO) — same container already in the Ocean Update
  - Commodity, sizes, quantities, lot information

The PL is linked to the Ocean Update by CONTAINER#.
Because db.py._find_existing() checks:
  (cliente_norm, unit_id_norm, po=None) → existing ocean-update row
building a record with container + PL# as PO will merge into the right row.
"""
import re
import logging
from typing import Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Subject must match: PM-xxx-nnn PL  (or just end with " PL")
_SUBJECT_RE = re.compile(
    r'\b(PM-[A-Z0-9]+-(\d+))\s+PL\b',
    re.IGNORECASE,
)

# Container number patterns (ISO: 4 letters + 6 digits + check digit, no dash)
_CONTAINER_RE = re.compile(r'\b([A-Z]{4}\d{7})\b', re.IGNORECASE)


def is_prime_time_pl(subject: str) -> bool:
    """Return True if this email subject looks like a Prime Time PL."""
    return bool(_SUBJECT_RE.search(subject or ''))


def parse_subject(subject: str) -> Optional[dict]:
    """
    Extract PL number from subject.
    'PM-E26-042 PL' → {'pl_number': 'PM-E26-042', 'po_norm': 'PM-E26-042'}
    """
    m = _SUBJECT_RE.search(subject or '')
    if not m:
        return None
    pl_number = m.group(1).upper()
    return {
        'pl_number': pl_number,
        'po_norm':   pl_number,  # PL# used as PO
        'po':        pl_number,
    }


def parse_html(html_body: str) -> dict:
    """
    Extract container number and any available info from PL HTML body.
    Returns a dict with keys: unit_id, unit_id_norm, commodity, quantity_description, lots_raw (raw text)
    """
    if not html_body:
        return {}

    soup = BeautifulSoup(html_body, 'lxml')
    text = soup.get_text(separator=' ')

    result: dict = {}

    # Try to find container number in text
    containers = _CONTAINER_RE.findall(text)
    if containers:
        # Deduplicate and take first valid-looking one
        seen: set[str] = set()
        for c in containers:
            c_up = c.upper()
            if c_up not in seen:
                seen.add(c_up)
                result.setdefault('unit_id', c_up)
                result.setdefault('unit_id_norm', c_up)
                break

    # Try to find commodity in a table cell labeled "COMMODITY" or "DESCRIPTION"
    for td in soup.find_all('td'):
        label = td.get_text(strip=True).upper()
        if label in ('COMMODITY', 'PRODUCT', 'DESCRIPTION', 'ITEM'):
            next_td = td.find_next_sibling('td')
            if next_td:
                val = next_td.get_text(strip=True)
                if val:
                    result['commodity_raw'] = val
                    break

    # Store raw text of the body for lot extraction later (Claude can parse this)
    # Trim to avoid blowing up the DB column
    raw = ' '.join(text.split())
    result['lots_raw'] = raw[:4000] if raw else None

    return result


def extract_container_from_text(text: str) -> Optional[str]:
    """Helper: extract first ISO container number from arbitrary text."""
    m = _CONTAINER_RE.search(text or '')
    return m.group(1).upper() if m else None
