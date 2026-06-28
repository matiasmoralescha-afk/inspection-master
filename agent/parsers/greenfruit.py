"""
GreenFruit arrival email parser.

Handles two email sources:
1. andrew@greenfruitavocados.com -- "GreenFruit [Origin] Arrivals [Date]"
   announcement emails (container/PO breakdown in body text)
2. ops@elitequalityassurance.com -- "UPCOMING LOADS" updates addressed to
   the GreenFruit team (container/PO lists in plain text body)

All GreenFruit shipments are avocados arriving in Miami.

Recognized body formats
-----------------------
Format A (container + PO pair):
    ZMOU8891181 / PO#120201
    ZMOU8973443 / PO#120203

Format B (vessel header + bare containers):
    7 containers below ETA 7/6 aboard of vessel St. John.
    ZMOU5569016 ZMOU8962541 ZMOU5567667 ...

Format C (shipper dash container):
    Montana - SMLU5476928 arriving on Monday 6/29
    Fruty Green - CAIU5547939 arriving on Monday 6/29
"""
import re
import logging
from datetime import datetime
from typing import Optional

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Standard ISO container number: 4-letter prefix + 7 digits
_CONTAINER_RE = re.compile(r'\b([A-Z]{4}\s*\d{6,7})\b', re.IGNORECASE)

# PO number inline: "/ PO#120201" or "/ PO 120201"
_CONTAINER_PO_RE = re.compile(
    r'([A-Z]{4}\s*\d{6,7})\s*/\s*PO[#\s]?(\d{5,7})',
    re.IGNORECASE,
)

# ETA: "ETA 6/29" or "ETA 7/6/26" or "arriving on Monday 6/29"
_ETA_RE = re.compile(
    r'(?:ETA\s+|arriving\s+on\s+(?:\w+\s+)?)(\d{1,2}/\d{1,2}(?:/\d{2,4})?)',
    re.IGNORECASE,
)

# "aboard of vessel St. John" or "on vessel Contship Cup"
_VESSEL_INTRO_RE = re.compile(
    r'(?:aboard(?:\s+of)?\s+vessel|on\s+vessel)\s+(.+?)(?=\s+to\s|\s+ETA\s|\Z)',
    re.IGNORECASE,
)

# Format C: "Shipper Name - CONTAINER arriving on Monday 6/29"
_SHIPPER_CONTAINER_RE = re.compile(
    r'(\w+(?:\s+\w+)*)\s*[\u2013\u2014\-]\s*([A-Z]{4}\d{6,7})\s+arriving\s+on\s+(?:\w+\s+)?(\d{1,2}/\d{1,2}(?:/\d{2,4})?)',
    re.IGNORECASE,
)

_COUNTRY_KEYWORDS = {
    'colombia': 'Colombia',
    'colombian': 'Colombia',
    'peru': 'Peru',
    'peruvian': 'Peru',
    'mexican': 'Mexico',
    'mexico': 'Mexico',
    'dominican': 'Dominican Republic',
    'chilean': 'Chile',
    'chile': 'Chile',
}


def detect_country_from_text(text: str) -> Optional[str]:
    """Scan subject or body for a country keyword."""
    lower = text.lower()
    for key, country in _COUNTRY_KEYWORDS.items():
        if key in lower:
            return country
    return None


def _html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, 'lxml')
    return soup.get_text(separator=' ')


def _normalize_eta(raw: Optional[str]) -> Optional[str]:
    """'6/29' or '7/6/26' -> 'YYYY-MM-DD' using current year when year missing."""
    if not raw:
        return None
    raw = raw.strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})$', raw)
    if m:
        mo, day = m.groups()
        year = datetime.now().year
        return f'{year}-{mo.zfill(2)}-{day.zfill(2)}'
    m2 = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', raw)
    if m2:
        mo, day, yr = m2.groups()
        yr = ('20' + yr) if len(yr) == 2 else yr
        return f'{yr}-{mo.zfill(2)}-{day.zfill(2)}'
    return raw


def _clean_unit_id(raw: str) -> str:
    """'ZMOU 897392-6' -> 'ZMOU8973926'."""
    return re.sub(r'[\s\-]', '', raw).upper()


def parse(body: str, subject: str = '') -> list[dict]:
    """
    Parse a GreenFruit email body (HTML or plain text).

    Returns a list of dicts, one per container:
        {unit_id, po, eta_fecha, vessel, country_of_origin, shipper}
    """
    if re.search(r'<(html|table|div|span|p)\b', body, re.IGNORECASE):
        text = _html_to_text(body)
    else:
        text = body

    text_oneline = re.sub(r'\s+', ' ', text)
    country = detect_country_from_text(subject + ' ' + text_oneline[:500])

    global_eta: Optional[str] = None
    m = _ETA_RE.search(text_oneline)
    if m:
        global_eta = _normalize_eta(m.group(1))

    global_vessel: Optional[str] = None
    m = _VESSEL_INTRO_RE.search(text_oneline)
    if m:
        raw_vessel = m.group(1).strip()
        raw_vessel = re.sub(r'\.\s+[A-Z]{3,}\d.*$', '', raw_vessel, flags=re.IGNORECASE)
        global_vessel = raw_vessel.rstrip(' .,;') or None

    records: list[dict] = []
    seen_ids: set[str] = set()

    # Format A: CONTAINER / PO#PO pairs
    for m in _CONTAINER_PO_RE.finditer(text_oneline):
        uid = _clean_unit_id(m.group(1))
        po  = m.group(2).strip()
        if uid in seen_ids:
            continue
        seen_ids.add(uid)
        records.append({
            'unit_id':           uid,
            'po':                po,
            'eta_fecha':         global_eta,
            'vessel':            global_vessel,
            'country_of_origin': country,
            'shipper':           None,
        })

    if records:
        logger.info('GreenFruit parser: %d rows via Format A (container/PO)', len(records))
        return records

    # Format C: Shipper - CONTAINER arriving on DATE
    for m in _SHIPPER_CONTAINER_RE.finditer(text_oneline):
        shipper   = m.group(1).strip()
        uid       = _clean_unit_id(m.group(2))
        eta_local = _normalize_eta(m.group(3))
        if uid in seen_ids:
            continue
        seen_ids.add(uid)
        records.append({
            'unit_id':           uid,
            'po':                None,
            'eta_fecha':         eta_local or global_eta,
            'vessel':            global_vessel,
            'country_of_origin': country,
            'shipper':           shipper,
        })

    if records:
        logger.info('GreenFruit parser: %d rows via Format C (shipper-container)', len(records))
        return records

    # Format B: bare container list after an ETA/vessel header
    for m in _CONTAINER_RE.finditer(text_oneline):
        uid = _clean_unit_id(m.group(1))
        if uid in seen_ids:
            continue
        if len(uid) < 10 or len(uid) > 12:
            continue
        seen_ids.add(uid)
        records.append({
            'unit_id':           uid,
            'po':                None,
            'eta_fecha':         global_eta,
            'vessel':            global_vessel,
            'country_of_origin': country,
            'shipper':           None,
        })

    if records:
        logger.info('GreenFruit parser: %d rows via Format B (bare container list)', len(records))
    else:
        logger.warning('GreenFruit parser: no containers found in message body')

    return records


def is_greenfruit_sender(sender: str, subject: str, to_cc: str = '') -> bool:
    """
    Returns True if this message is a GreenFruit arrival announcement.

    Matches:
    - From andrew@greenfruitavocados.com with "Arrivals" in subject
    - Subject contains "UPCOMING LOADS" AND greenfruitavocados.com in recipients
    """
    sender_lower  = sender.lower()
    subject_upper = subject.upper()
    to_cc_lower   = to_cc.lower()

    if 'andrew@greenfruitavocados.com' in sender_lower:
        if 'ARRIVALS' in subject_upper or 'GREENFRUIT' in subject_upper:
            return True

    if 'UPCOMING LOADS' in subject_upper:
        if 'greenfruitavocados.com' in to_cc_lower:
            return True

    return False
