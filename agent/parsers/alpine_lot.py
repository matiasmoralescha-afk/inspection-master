"""
Alpine Fresh — Los Angeles lot request parser.

Carlos Gallo (cgallo@alpinefresh.com) announces each Alpine LA inspection
with a bare subject (confirmed by ops 07/2026 — every one of these requests
must end in an inspection report):

  Subject: "LOT CARRIL011 PO 92364"
  Subject: "LOT UNIOAG029 PO 92218"

These are air shipments arriving at the LCX Fresh warehouse (LAX).
The matching inspection report arrives later with the combined PO format
"92364//CARRIL011", so the record stores po as "<po>//<lot>" to land on
the same lookup_key and merge instead of duplicating.

Like altar_lot.py, this is a lot-linking announcement — no table, no ETA.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# "LOT <shipper+seq> PO <number>" — lot like CARRIL011 / UNIOAG029
_SUBJECT_RE = re.compile(
    r'\bLOT\s+([A-Z0-9]{4,15})\s+PO\s+(\d{4,8})\b',
    re.IGNORECASE,
)


def is_alpine_lot(subject: str, sender: str) -> bool:
    """True for Alpine 'LOT X PO Y' announcements from alpinefresh.com."""
    if 'alpinefresh.com' not in (sender or '').lower():
        return False
    return bool(_SUBJECT_RE.search(subject or ''))


def parse_subject(subject: str) -> Optional[dict]:
    """Extract {'lot': ..., 'po': ..., 'po_combined': 'PO//LOT'} from the subject."""
    m = _SUBJECT_RE.search(subject or '')
    if not m:
        return None
    lot = m.group(1).upper()
    po = m.group(2)
    return {
        'lot': lot,
        'po': po,
        # Inspection reports for these arrive as "92364//CARRIL011"
        'po_combined': f'{po}//{lot}',
    }
