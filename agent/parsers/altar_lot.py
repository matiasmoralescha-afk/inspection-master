"""
Altar Produce lot-announcement email parser.

Melissa (melissa@altarproduce.com) announces each lot with:

  Subject: "DC262004M // SMLU 5472542"
  Subject: "CP260319M // ZMOU 8960111"

  Body: "DC262004M SMLU 5472542  PACKING DATE 6.29  STD..1325 DS..940 ... TOTAL 2800"

The subject links a lot (→ PO) to a container. Like the Prime Time PL flow,
upserting {cliente, unit_id, po} merges into the existing ocean-update row
(or creates a placeholder row the ocean update will later enrich).

We ignore "Recall:" messages (Outlook recalls of a mistaken send).
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# "<LOT> // <CONTAINER>" — lot like DC262004M / CP260319M / SU26048,
# container ISO format with optional space (SMLU 5472542)
_SUBJECT_RE = re.compile(
    r'\b([A-Z]{2,3}\d{4,8}[A-Z]?)\s*//\s*([A-Z]{4}\s?\d{7})\b',
    re.IGNORECASE,
)

_PACKING_DATE_RE = re.compile(
    r'PACKING\s+DATE\s+(\d{1,2})[./](\d{1,2})',
    re.IGNORECASE,
)


def is_altar_lot(subject: str, sender: str) -> bool:
    """True for Altar 'LOT // CONTAINER' announcements (not recalls)."""
    subj = subject or ''
    if subj.strip().upper().startswith('RECALL:'):
        return False
    if 'altarproduce.com' not in (sender or '').lower():
        return False
    return bool(_SUBJECT_RE.search(subj))


def parse_subject(subject: str) -> Optional[dict]:
    """Extract {'po': lot, 'unit_id': container} from the subject."""
    m = _SUBJECT_RE.search(subject or '')
    if not m:
        return None
    return {
        'po':      m.group(1).strip().upper(),
        'unit_id': m.group(2).strip().upper(),
    }


def parse_packing_date(body_text: str, year: int) -> Optional[str]:
    """'PACKING DATE 6.29' → 'YYYY-06-29' using the message's year."""
    m = _PACKING_DATE_RE.search(body_text or '')
    if not m:
        return None
    mm, dd = int(m.group(1)), int(m.group(2))
    try:
        return f'{year:04d}-{mm:02d}-{dd:02d}'
    except ValueError:
        return None
