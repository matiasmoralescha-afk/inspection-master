import re
from datetime import datetime
from typing import Optional

# --- unit_id / AWB / Container ---

_INVALID_UNIT_IDS = {'DELIVERY', 'N/A', 'NA', 'TBD', 'TBC', 'REJECT'}

def normalize_unit_id(s: Optional[str]) -> Optional[str]:
    """Strip spaces, dashes, tabs, periods → uppercase. 'SMLU 547697-5' → 'SMLU5476975'."""
    if not s:
        return None
    result = re.sub(r'[\s\-\t\.]', '', s).upper()
    if result in _INVALID_UNIT_IDS:
        return None
    return result or None


# --- PO ---

_PO_PLACEHOLDERS = {'PO', 'N/A', 'NA', 'TBD', 'TBC', ''}

def normalize_po(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    cleaned = s.strip().upper()
    return None if cleaned in _PO_PLACEHOLDERS else cleaned


# --- Client ---

def normalize_client(raw: str, clients_config: dict) -> Optional[str]:
    """Resolve aliases to canonical display_name. Returns None if unrecognized."""
    raw_lower = raw.strip().lower()
    for _key, cfg in clients_config.items():
        candidates = [cfg['display_name'].lower()] + [a.lower() for a in cfg.get('aliases', [])]
        if raw_lower in candidates:
            return cfg['display_name']
    return None


def detect_client_from_subject(subject: str, clients_config: dict) -> Optional[str]:
    """
    Scan email subject against each client's subject_patterns (case-insensitive substring match).
    Returns the canonical display_name of the first match, or None.
    Longer patterns are tried first to avoid false matches (e.g., BAJA SON before SON).
    """
    subject_upper = (subject or '').upper()
    # Sort by pattern length descending to prefer more specific matches
    candidates: list[tuple[str, str]] = []
    for _key, cfg in clients_config.items():
        for pattern in cfg.get('subject_patterns', []):
            candidates.append((pattern.upper(), cfg['display_name']))
    candidates.sort(key=lambda t: len(t[0]), reverse=True)

    for pattern, display_name in candidates:
        if pattern in subject_upper:
            return display_name
    return None


def normalize_client_name(raw: str) -> str:
    """Uppercase and strip for storage as cliente_norm."""
    return raw.strip().upper()


# --- Commodity ---

_COMMODITY_SYNONYMS: dict[str, str] = {
    'apple': 'Apples',
    'apples': 'Apples',
    'brussel sprouts': 'Brussels Sprouts',
    'brussels sprouts': 'Brussels Sprouts',
    'brussel sprout': 'Brussels Sprouts',
    'asparagus-general': 'Asparagus',
    'asparagus-square one': 'Asparagus',
    'asparagus': 'Asparagus',
    'avocado': 'Avocado',
    'avocados': 'Avocado',
    'dragon fruit': 'Dragon Fruit',
    'dragonfruit': 'Dragon Fruit',
    'lychee': 'Lychee',
    'rambutan': 'Rambutan',
    'lime': 'Limes',
    'limes': 'Limes',
    'lemon': 'Lemons',
    'lemons': 'Lemons',
    'bell pepper': 'Bell Pepper',
    'bell peppers': 'Bell Pepper',
    'snow peas': 'Snow Peas',
    'peas': 'Peas',
    'vegetables': 'Vegetables',
}

def normalize_commodity(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    key = s.strip().lower()
    return _COMMODITY_SYNONYMS.get(key, s.strip().title()) or None


def extract_commodity_from_description(qty_desc: Optional[str]) -> Optional[str]:
    """Extract commodity from '2500 BOXES OF ASPARAGUS' or similar cells."""
    if not qty_desc:
        return None
    text = qty_desc.upper()
    m = re.search(r'(?:BOXES?|CARTONS?|CASES?|BAGS?|UNITS?)\s+OF\s+([A-Z][A-Z\s]+)', text)
    if m:
        return normalize_commodity(m.group(1).strip())
    return normalize_commodity(qty_desc.strip())


# --- Shipper ---

def extract_country_from_shipper(shipper_raw: Optional[str]) -> Optional[str]:
    """Extract country from 'TA EXPORT(PERU)' → 'PERU'."""
    if not shipper_raw:
        return None
    m = re.search(r'\(([A-Z]{2,})\)\s*$', shipper_raw.strip())
    return m.group(1) if m else None


def extract_shipper_name(shipper_raw: Optional[str]) -> Optional[str]:
    """Strip country suffix from 'TA EXPORT(PERU)' → 'TA EXPORT'."""
    if not shipper_raw:
        return None
    cleaned = re.sub(r'\s*\([A-Z]{2,}\)\s*$', '', shipper_raw.strip()).strip()
    return cleaned or None


# --- Dates ---

_MONTH_ABBR = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
}

def normalize_date(s: Optional[str]) -> Optional[str]:
    """Parse date strings to YYYY-MM-DD. Returns raw string if format unknown."""
    if not s:
        return None
    s = s.strip()
    if not s or s.upper() in {'TBC', 'TBD', 'N/A', 'NA'}:
        return None

    # MM/DD/YY or MM/DD/YYYY
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', s)
    if m:
        month, day, year = m.groups()
        year = ('20' + year) if len(year) == 2 else year
        return f'{year}-{month.zfill(2)}-{day.zfill(2)}'

    # Already YYYY-MM-DD
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s

    # DD-Mon format: "29-Jun" → "2026-06-29"
    m2 = re.match(r'^(\d{1,2})-([A-Za-z]{3})$', s)
    if m2:
        day, mon = m2.groups()
        month_num = _MONTH_ABBR.get(mon.lower())
        if month_num:
            year = datetime.now().year
            return f'{year}-{month_num}-{day.zfill(2)}'

    # Mon-DD format: "Jun-29"
    m3 = re.match(r'^([A-Za-z]{3})-(\d{1,2})$', s)
    if m3:
        mon, day = m3.groups()
        month_num = _MONTH_ABBR.get(mon.lower())
        if month_num:
            year = datetime.now().year
            return f'{year}-{month_num}-{day.zfill(2)}'

    # Fallback: extract MM/DD/YY from a longer string, tolerating stray spaces
    # around the slashes as seen in real Alpine emails:
    #   "ESTIMATED 10:00 AM 06/23/26"      → "2026-06-23"
    #   "ESTIMATED 10 :30 AM 07/ 02/ 26"   → "2026-07-02"
    #   "PENDING ESTIMATED IN MIAMI 06/ 19 /26" → "2026-06-19"
    compact = re.sub(r'\s*/\s*', '/', s)
    m_fb = re.search(r'(\d{1,2}/\d{1,2}/\d{2,4})', compact)
    if m_fb:
        return normalize_date(m_fb.group(1))

    # Fallback: MM/DD with no year ("07/02@05:00HRS TBC" — Prime Time) →
    # assume current year, same convention as the DD-Mon formats above.
    m_md = re.search(r'\b(\d{1,2})/(\d{1,2})\b', compact)
    if m_md:
        month, day = m_md.groups()
        if 1 <= int(month) <= 12 and 1 <= int(day) <= 31:
            return f'{datetime.now().year}-{month.zfill(2)}-{day.zfill(2)}'

    # Unparseable → None. Never return raw text: date columns feed sorting,
    # comparisons, and the dia_disponible copy — garbage here silently drops
    # the shipment from the dashboard's agenda views.
    return None


def normalize_time(s: Optional[str]) -> Optional[str]:
    """Parse time strings to HH:MM:SS."""
    if not s:
        return None
    s = s.strip()
    if s.upper() in {'TBC', 'TBD', 'N/A'}:
        return None
    m = re.match(r'^(\d{1,2}):(\d{2})(?::(\d{2}))?$', s)
    if m:
        h, mn, sc = m.groups()
        return f'{h.zfill(2)}:{mn}:{(sc or "00")}'
    return s
