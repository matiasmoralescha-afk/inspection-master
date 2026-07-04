"""Tests for the Sunkist Container Status .xlsx parser, built from the real
sheet layout observed 07/03/26: row 2 header, master row per container (17
columns A-Q), followed by '-->' event-log rows, with occasional vessel
section-header rows ("<VESSEL> into <PORT>") that must be skipped."""
import io
from datetime import datetime

import openpyxl
import pytest

from agent.parsers import sunkist_status as sunkist


def _row(entry=None, vessel=None, eta=None, origin=None, commodity=None,
         container=None, bl=None, warehouse=None):
    """17 columns (A-Q), matching the real header order."""
    return [entry, vessel, eta, origin, commodity, None, None,
            container, bl, None, None, None, None, None, warehouse, None, None]


def _event(when, text):
    row = [None] * 17
    row[0] = '-->'
    row[1] = when
    row[4] = text
    return row


def _build_xlsx(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([None] * 17)  # row 1: blank
    ws.append(['Entry#', 'Vessel', 'ETA', 'Origin', 'Commodity', 'Port/Terminal',
               'Shipper', 'Container', 'Bill of Lading', 'Treatment', 'Status',
               'USDA CT', 'ISF Filed', 'Trucker', 'Warehouse', 'Loc.', 'Customer'])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_is_sunkist_status_matches_real_subject():
    assert sunkist.is_sunkist_status('Sunkist Container Status (2026-07-03_160719)')
    assert sunkist.is_sunkist_status('sunkist container status (2026-07-01_071251)')
    assert not sunkist.is_sunkist_status('Sunkist Global | Oranges | Ocean Report')


@pytest.fixture
def two_container_xlsx():
    rows = [
        ['POLAR BRASIL into PHIL', None, None, None, None, None, None,
         None, None, None, None, None, None, None, None, None, None],
        _row('97E-0662044-8', 'POLAR BRASIL', datetime(2026, 6, 29), 'CHILE', 'CLEMENTINES',
             'MNBU4291490', 'M: MAEU271558830', 'MANFREDI PEDRICKTOWN'),
        _event('7/2, 3:21 PM (EST) by amcclellan', 'MNBU4291490 - Gate In'),
        _event('6/30, 3:55 PM (EST) by amcclellan', 'MNBU4291490 - Picked Up'),
        _event('6/29, 7:35 PM (EST) by amcclellan', 'MNBU4291490 - Discharge'),
        _row('97E-0662043-0', 'POLAR BRASIL', datetime(2026, 6, 29), 'CHILE', 'CLEMENTINES',
             'MNBU4052480', 'M: MAEU271785683', 'MANFREDI PEDRICKTOWN'),
        _event('6/29, 9:55 PM (EST) by amcclellan', 'MNBU4052480 - Discharge'),
        _event('6/26, 2:16 PM (EST) by amcclellan', 'MNBU4052480 - Pick Up'),
    ]
    return _build_xlsx(rows)


def test_parse_xlsx_extracts_both_containers_and_skips_section_header(two_container_xlsx):
    records = sunkist.parse_xlsx(two_container_xlsx)
    assert [r['unit_id'] for r in records] == ['MNBU4291490', 'MNBU4052480']


def test_parse_xlsx_gate_in_confirms_warehouse_arrival(two_container_xlsx):
    records = sunkist.parse_xlsx(two_container_xlsx)
    gated = next(r for r in records if r['unit_id'] == 'MNBU4291490')
    assert gated['warehouse_arrival_confirmed'] is True
    # _event_date assumes the current year, same convention as sq1.py/fresh_way.py
    assert gated['warehouse_arrival_at'] == f'{datetime.now().year}-07-02'


def test_parse_xlsx_no_gate_in_not_confirmed(two_container_xlsx):
    records = sunkist.parse_xlsx(two_container_xlsx)
    not_gated = next(r for r in records if r['unit_id'] == 'MNBU4052480')
    assert not_gated['warehouse_arrival_confirmed'] is False
    assert not_gated['warehouse_arrival_at'] is None
    assert not_gated['latest_event'] == 'Discharge'


def test_parse_xlsx_eta_from_datetime_cell(two_container_xlsx):
    records = sunkist.parse_xlsx(two_container_xlsx)
    assert records[0]['eta_fecha'] == '2026-06-29'


def test_parse_xlsx_carries_entry_vessel_origin_commodity(two_container_xlsx):
    records = sunkist.parse_xlsx(two_container_xlsx)
    r = records[0]
    assert r['entry_no'] == '97E-0662044-8'
    assert r['vessel'] == 'POLAR BRASIL'
    assert r['origin'] == 'CHILE'
    assert r['commodity_raw'] == 'CLEMENTINES'
    assert r['warehouse'] == 'MANFREDI PEDRICKTOWN'


def test_parse_xlsx_empty_sheet_returns_empty_list():
    empty = _build_xlsx([])
    assert sunkist.parse_xlsx(empty) == []
