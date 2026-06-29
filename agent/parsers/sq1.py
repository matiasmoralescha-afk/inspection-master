"""
Square One Farms inspection request email parser.

Two email formats:
1. Transkool (from Laurence Baca / Renzo Garro via Square One):
   Subject: "SQ1 Inspection Request - Transkool - eta 6/29/ LOT ID SDC-0326"
   Subject: "SQ1 Inspection Request - Transkool - eta 6/29 / LOT ID DLOR-0426 / DOL-2926"
   â Extract lot IDs and ETA from subject line.

2. General (from Angelica Alvarez via ops@elitequalityassurance.com):
   Subject: "SQ1 Inspection Request"
   Body:  "We have these lots arriving at the warehouse today.
           DOL-2726/ DLOR-0126/ DLOR-0226 / Transfer 8-9PM
           TA-7990B/ ZMOU8974727 out of fumigation"
   â Extract lot IDs (and optional container numbers) from body text.

Returns one record per lot with: {lot_id, unit_id, awb, eta_fecha}
"""
import re
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# Square One lot ID: 2-5 uppercase letters, hyphen, 3-6 digits, optional trailing letter
# e.g. DOL-2726, DLOR-0126, SDC-0326, MFB-0126, TR-23312, DC-5574, OS-23168,
#      TA-2285B, DET-1736, AGP-3638B
_LOT_RE = re.compile(r'\b([A-Z]{2,5}-\d{3,6}[A-Z]?)\b', re.IGNORECASE)

# ISO container number: 4 letters + 6-7 digits
_CONTAINER_RE = re.compile(r'\b([A-Z]{4}\d{6,7})\b', re.IGNORECASE)

# Air waybill: "729-9118 1381" or "369 â 1022 5574" or "729-91180972"
_AWB_RE = re.compile(r'\b(\d{3}[\sââ\-]+\d{4}[\sââ\-]?\d{4})\b')

# ETA in subject: "eta 6/29" or "eta 6/29/26"
_ETA_RE = re.compile(r'\beta\s+(\d{1,2}/\d{1,2}(?:/\d{2,4})?)', re.IGNORECASE)

# "LOT ID xxx / yyy / zzz" in subject (everything after LOT ID)
_LOT_ID_SUBJ_RE = re.compile(r'LOT\s+ID\s+(.+?)$', re.IGNORECASE)

# Lines to skip when parsing body
_SKIP_PHRASES = (
    'good morning', 'good afternoon', 'good evening',
    'please let me', 'please see', 'please support',
    'thank you', 'kindly confirm', 'best regards',
    'as per our conversation', 'as per our call',
    'hope you', 'just wanted', 'info received',
    'we have another', 'we have this lot', 'we have these lots',
    'arriving at the warehouse', 'arriving tomorrow', 'arriving today',
    'square one farms', 'elitequalityassurance', '@sq1farms',
)


def _normalize_eta(raw: Optional[str]) -> Optional[str]:
    """'6/29' or '6/29/26' â 'YYYY-MM-DD'."""
    if not raw:
        return None
    raw = raw.strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})$', raw)
    if m:
        mo, day = m.groups()
        return f'{datetime.now().year}-{mo.zfill(2)}-{day.zfill(2)}'
    m2 = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', raw)
    if m2:
        mo, day, yr = m2.groups()
        yr = ('20' + yr) if len(yr) == 2 else yr
        return f'{yr}-{mo.zfill(2)}-{day.zfill(2)}'
    return None


def parse(subject: str, body: str) -> list[dict]:
    """
    Parse a Square One inspection request email.

    Returns list of dicts:
        {lot_id, unit_id, awb, eta_fecha}

    lot_id  â Square One lot / PO identifier (e.g. 'DOL-2726')
    unit_id â ISO container number if found on the same line (or None)
    awb     â air waybill number if found on the same line (or None)
    eta_fecha â YYYY-MM-DD from subject ETA, or None
    """
    records: list[dict] = []
    seen_lots: set[str] = set()

    # ââ Global ETA from subject ââââââââââââââââââââââââââââââââââââââââââââââ
    eta: Optional[str] = None
    m = _ETA_RE.search(subject)
    if m:
        eta = _normalize_eta(m.group(1))

    # ââ Format 1: LOT ID(s) in subject line âââââââââââââââââââââââââââââââââ
    m = _LOT_ID_SUBJ_RE.search(subject)
    if m:
        lot_part = m.group(1).strip()
        # Split by / & ,
        parts = re.split(r'\s*[/&,]\s*', lot_part)
        for part in parts:
            part = part.strip()
            lot_m = _LOT_RE.match(part)
            if lot_m:
                lot_id = lot_m.group(1).upper()
                if lot_id not in seen_lots:
                    seen_lots.add(lot_id)
                    records.append({
                        'lot_id':   lot_id,
                        'unit_id':  None,
                        'awb':      None,
                        'eta_fecha': eta,
                    })

    # ââ Format 2: lots listed in body text ââââââââââââââââââââââââââââââââââ
    # Parse line by line; skip boilerplate lines
    for line in body.splitlines():
        line_clean = re.sub(r'\s+', ' ', line).strip()
        if not line_clean:
            continue
        lower = line_clean.lower()
        if any(phrase in lower for phrase in _SKIP_PHRASES):
            continue

        lots_in_line       = _LOT_RE.findall(line_clean)
        containers_in_line = _CONTAINER_RE.findall(line_clean)
        awbs_in_line       = _AWB_RE.findall(line_clean)

        for lot in lots_in_line:
            lot_id = lot.upper()
            if lot_id in seen_lots:
                continue
            seen_lots.add(lot_id)
            unit_id = containers_in_line[0].upper() if containers_in_line else None
            awb     = awbs_in_line[0].strip() if awbs_in_line else None
            records.append({
                'lot_id':    lot_id,
                'unit_id':   unit_id,
                'awb':       awb,
                'eta_fecha': eta,
            })

    if records:
        logger.info('SQ1 parser: %d lot(s) from subject=%r', len(records), subject[:80])
    else:
        logger.warning('SQ1 parser: no lots found. subject=%r', subject[:80])

    return records
