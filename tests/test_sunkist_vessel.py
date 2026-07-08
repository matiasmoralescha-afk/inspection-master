"""Tests for the Sunkist vessel-thread parser, based on the real HSL Nike and
Seaboard Verde threads observed 07/2026 (721 Logistics' standard template)."""
from agent.parsers import sunkist_vessel as sv

HSL_NIKE_SUBJECT = 'HSL NIKE - SUNKIST GLOBAL - LEMONS - ETA 07/05'

HSL_NIKE_HTML = """
<html><body>
<p>Good morning,</p>
<p>The HSL NIKE has just departed Cartagena and is in transit to Port Everglades,
currently tracking arrival on Sunday morning; 7/5 @ 11:00 AM.</p>
<table>
<tr><td>CONTAINER#</td><td>COMMODITY</td><td>TRUCKER</td><td>FDA</td><td>CBP</td><td>WHSE</td><td>DELIVERY</td></tr>
<tr><td>CAIU5678287</td><td>Lemons</td><td>PRO Transport</td><td>Released</td><td>Pre-Cleared</td><td>ACL Miami</td><td>Monday 07/06</td></tr>
<tr><td>SEGU9897207</td><td>Lemons</td><td>PRO Transport</td><td>Released</td><td>Pre-Cleared</td><td>ACL Miami</td><td>Monday 07/06</td></tr>
</table>
</body></html>
"""

# Early-stage announcement: no data rows yet (just the header), as seen in the
# first message of a real thread before container details are available.
ANNOUNCEMENT_ONLY_HTML = """
<html><body>
<p>Good afternoon Chuck, the SEABOARD VERDE is expected to arrive by Sunday.</p>
<table>
<tr><td>CONTAINER#</td></tr>
</table>
</body></html>
"""


def test_parse_subject_extracts_vessel_commodity_eta():
    r = sv.parse_subject(HSL_NIKE_SUBJECT)
    assert r == {'vessel': 'HSL NIKE', 'commodity': 'LEMONS', 'eta_fecha': '2026-07-05'}


def test_parse_subject_handles_re_prefix():
    r = sv.parse_subject('RE: ' + HSL_NIKE_SUBJECT)
    assert r['vessel'] == 'HSL NIKE'


def test_parse_subject_rejects_unrelated_subjects():
    assert sv.parse_subject('OCEAN UPDATE ALTAR PRODUCE 7/02') is None
    assert sv.parse_subject('Sunkist Container Status (2026-07-03_160719)') is None


def test_is_sunkist_vessel():
    assert sv.is_sunkist_vessel(HSL_NIKE_SUBJECT)
    assert sv.is_sunkist_vessel('RE: ' + HSL_NIKE_SUBJECT)
    assert not sv.is_sunkist_vessel('SQ1 Inspection Request')


def test_parse_html_extracts_containers_with_delivery_date():
    records = sv.parse_html(HSL_NIKE_HTML)
    assert len(records) == 2
    assert records[0]['unit_id'] == 'CAIU5678287'
    assert records[0]['warehouse'] == 'ACL Miami'
    assert records[0]['delivery_date'] == '2026-07-06'
    assert records[0]['trucker'] == 'PRO Transport'
    assert records[0]['fda_status'] == 'Released'
    assert records[0]['customs_status'] == 'Pre-Cleared'


def test_parse_html_announcement_only_returns_empty():
    assert sv.parse_html(ANNOUNCEMENT_ONLY_HTML) == []


def test_parse_html_empty_body_returns_empty():
    assert sv.parse_html('') == []
    assert sv.parse_html(None) == []


def test_delivery_date_beats_vessel_eta():
    """The whole point of this parser: DELIVERY (07/06) is a day later than
    the vessel ETA in the subject (07/05) — main.py must prefer DELIVERY."""
    subj = sv.parse_subject(HSL_NIKE_SUBJECT)
    rows = sv.parse_html(HSL_NIKE_HTML)
    assert subj['eta_fecha'] == '2026-07-05'
    assert rows[0]['delivery_date'] == '2026-07-06'
