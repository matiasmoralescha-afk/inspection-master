"""
Ocean Report / Ocean Update HTML table parser.

Supports two header-row formats produced by different freight agencies:
  - #00B050 green  → Alpine Fresh / Growers Are Us (Alba Wheels Up agency)
  - #e8e8e8 gray   → Altar Produce / Prime Time / Baja Son (Advance Customs Brokers agency)

Header row is detected by background-color in <td> style attributes.
The specific color depends on which agency sent the report; we try green first,
fall back to gray. Claude Haiku maps the (varying) column names to canonical fields.
"""
import re
import logging
from typing import Optional
from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

_GREEN_RE = re.compile(r'#00b050', re.IGNORECASE)
_GRAY_RE  = re.compile(r'#e8e8e8', re.IGNORECASE)
# Sentinel pattern that never matches — used when the header row is found by the
# keyword fallback (there is no header background color to skip repeated headers).
_NEVER_RE = re.compile(r'(?!)')

# Common column names across agencies, used as a content-based fallback when the
# header background color changes and color detection fails.
_HEADER_KEYWORDS = (
    'CONTAINER', 'ETA', 'VESSEL', 'SHIPPER', 'COMMODITY', 'CARRIER',
    'PALLET', 'ARRIVAL', 'DESCRIPTION', 'CUSTOMS', 'FDA', 'AWB', 'BL',
)


def _bg_match(tag: Tag, pattern: re.Pattern) -> bool:
    style = tag.get('style', '')
    return bool(pattern.search(style))


def _looks_like_header(tds: list[Tag]) -> bool:
    """Heuristic: a row is a header if several of its cells look like column names."""
    hits = 0
    for td in tds:
        text = (_cell_text(td) or '').upper()
        if not text or len(text) > 40:
            continue
        if any(kw in text for kw in _HEADER_KEYWORDS):
            hits += 1
    return hits >= 3


def _cell_text(cell: Tag) -> Optional[str]:
    text = ' '.join(cell.get_text(separator=' ').split()).strip()
    return text if text else None


def _find_header_row(soup: BeautifulSoup) -> tuple[Optional[Tag], re.Pattern]:
    """
    Find the first <tr> whose <td>s carry the header background color.
    Returns (header_row, color_pattern_used) or (None, _GREEN_RE).
    Tries green first, then gray.
    """
    for pattern in (_GREEN_RE, _GRAY_RE):
        for tr in soup.find_all('tr'):
            tds = tr.find_all('td', recursive=False) or tr.find_all('td')
            if tds and any(_bg_match(td, pattern) for td in tds):
                return tr, pattern

    # Fallback: no known header color matched (agency may have changed styling).
    # Detect the header row by its content so we don't silently drop shipments.
    for tr in soup.find_all('tr'):
        tds = tr.find_all('td', recursive=False) or tr.find_all('td')
        if tds and _looks_like_header(tds):
            logger.warning(
                'Ocean parser: header color not found — using content-based '
                'fallback. Check whether the agency changed the table styling.'
            )
            return tr, _NEVER_RE

    return None, _GREEN_RE


def parse(html_body: str) -> list[dict]:
    """
    Parse an Ocean Report or Ocean Update HTML email.

    Returns a list of dicts, one per container/shipment row:
        [{"ETA": "06/16/26", "CONTAINER#": "ABCD1234567", ...}, ...]

    Headers are the literal column names from the email (not yet mapped to
    canonical fields — that's claude_client.map_headers's job).
    Empty cells are represented as None.
    """
    soup = BeautifulSoup(html_body, 'lxml')

    header_row, header_color = _find_header_row(soup)

    if header_row is None:
        logger.warning('Ocean parser: no recognized header row found in HTML')
        return []

    header_cells = header_row.find_all('td')
    headers = [_cell_text(td) for td in header_cells]

    if not any(headers):
        logger.warning('Ocean parser: header row found but all cells are empty')
        return []

    logger.debug('Ocean parser headers: %s', headers)

    table: Optional[Tag] = header_row.find_parent('table')
    if table is None:
        logger.warning('Ocean parser: could not find parent table of header row')
        return []

    rows: list[dict] = []
    past_header = False

    for tr in table.find_all('tr'):
        if tr is header_row:
            past_header = True
            continue
        if not past_header:
            continue

        tds = tr.find_all('td')
        if not tds:
            continue

        # Skip repeated header rows (same background color as detected header)
        if any(_bg_match(td, header_color) for td in tds):
            continue

        values = [_cell_text(td) for td in tds]

        if not any(values):
            continue

        n = min(len(headers), len(values))
        row: dict = {}
        for i in range(n):
            h = headers[i]
            if h is not None:
                row[h] = values[i]

        rows.append(row)

    logger.info('Ocean parser: extracted %d data rows', len(rows))
    return rows
