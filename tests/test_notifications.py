"""Tests for the la_request_overdue notification event (once-ever)."""
from datetime import date, timedelta

import pytest

from agent import db as db_mod
from agent import notifications as notif


@pytest.fixture
def conn(tmp_path, monkeypatch):
    # Sin canales externos configurados: solo se registra el push
    monkeypatch.delenv('NOTIFY_WHATSAPP', raising=False)
    monkeypatch.delenv('NOTIFY_EMAILS', raising=False)
    return db_mod.init_db(str(tmp_path / 'test.db'))


def _insert_shipment(conn, **overrides):
    record = {
        'cliente': 'Alpine Fresh',
        'cliente_norm': 'ALPINE FRESH',
        'tipo_carga': 'air',
        'po': '92364//CARRIL011',
        'po_norm': '92364//CARRIL011',
        'commodity': 'Asparagus',
        'location': 'Los Angeles',
        'ready_for_inspection': 1,
        'dia_disponible_para_inspeccion': (date.today() - timedelta(days=3)).isoformat(),
    }
    record.update(overrides)
    db_mod.upsert_shipment(conn, record)
    conn.commit()
    return dict(conn.execute(
        'SELECT * FROM shipments WHERE po_norm = ?', (record['po_norm'],)
    ).fetchone())


def _events(conn, shipment_id):
    return [r['event_type'] for r in conn.execute(
        'SELECT event_type FROM notifications WHERE shipment_id = ?', (shipment_id,)
    ).fetchall()]


def test_la_request_overdue_fires_after_two_days(conn):
    s = _insert_shipment(conn)
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' in _events(conn, s['id'])


def test_la_request_overdue_fires_only_once_ever(conn):
    s = _insert_shipment(conn)
    notif.check_and_notify(s, None, conn, None)
    notif.check_and_notify(s, None, conn, None)
    events = _events(conn, s['id'])
    assert events.count('la_request_overdue') == 1


def test_la_request_overdue_not_before_two_days(conn):
    s = _insert_shipment(
        conn,
        po='92400//CARRIL012', po_norm='92400//CARRIL012',
        dia_disponible_para_inspeccion=(date.today() - timedelta(days=1)).isoformat(),
    )
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' not in _events(conn, s['id'])


def test_la_request_overdue_only_for_los_angeles(conn):
    s = _insert_shipment(
        conn,
        po='92401//MIAMI01', po_norm='92401//MIAMI01',
        location='Miami',
    )
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' not in _events(conn, s['id'])


def test_la_request_overdue_not_after_report_sent(conn):
    s = _insert_shipment(
        conn,
        po='92402//CARRIL013', po_norm='92402//CARRIL013',
        report_sent=1,
    )
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' not in _events(conn, s['id'])


def test_la_request_overdue_fires_for_fresh_way_vegland(conn):
    s = _insert_shipment(
        conn,
        cliente='Fresh Way', cliente_norm='FRESH WAY',
        po='10120', po_norm='10120',
        commodity='Dragon Fruit',
    )
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' in _events(conn, s['id'])


def test_la_request_overdue_not_for_fresh_way_miami(conn):
    s = _insert_shipment(
        conn,
        cliente='Fresh Way', cliente_norm='FRESH WAY',
        po='10121', po_norm='10121',
        location='Miami',
    )
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' not in _events(conn, s['id'])


def test_la_request_overdue_not_for_other_clients(conn):
    s = _insert_shipment(
        conn,
        cliente='Robinson Fresh', cliente_norm='ROBINSON FRESH',
        po='CF26509', po_norm='CF26509',
    )
    notif.check_and_notify(s, None, conn, None)
    assert 'la_request_overdue' not in _events(conn, s['id'])
