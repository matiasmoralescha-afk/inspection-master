"""Tests for db.py's _find_existing merge logic, covering the duplicate-row
bug found 07/08/26: GCXU8022816 (Altar Produce) got two separate rows —
one from an ocean_update (no po yet) and one from altar_lot (po known) —
because the merge lookup only covered inspection-report-after-ocean-update,
not the reverse order."""
from agent import db as db_mod


def _shipment(**overrides):
    record = {
        'cliente': 'Altar Produce',
        'cliente_norm': 'ALTAR PRODUCE',
        'tipo_carga': 'ocean',
        'unit_id': 'GCXU8022816',
        'unit_id_norm': 'GCXU8022816',
    }
    record.update(overrides)
    return record


def test_po_then_no_po_merges_into_same_row(tmp_path):
    """altar_lot (has po) arrives first, ocean_update (no po) arrives second
    — must merge into the same row, not create a duplicate."""
    conn = db_mod.init_db(str(tmp_path / 'test.db'))

    db_mod.upsert_shipment(conn, _shipment(po='EN265953M', po_norm='EN265953M', commodity='Asparagus'))
    result = db_mod.upsert_shipment(conn, _shipment(vessel='SEABOARD VALOR - 15'))

    rows = conn.execute(
        "SELECT * FROM shipments WHERE cliente_norm='ALTAR PRODUCE' AND unit_id_norm='GCXU8022816'"
    ).fetchall()
    assert len(rows) == 1
    assert result == 'updated'
    assert rows[0]['po'] == 'EN265953M'  # not overwritten by the null-po record
    assert rows[0]['vessel'] == 'SEABOARD VALOR - 15'


def test_no_po_then_po_merges_into_same_row(tmp_path):
    """The already-working direction: ocean_update first, altar_lot/report second."""
    conn = db_mod.init_db(str(tmp_path / 'test.db'))

    db_mod.upsert_shipment(conn, _shipment(commodity='Asparagus'))
    result = db_mod.upsert_shipment(conn, _shipment(po='EN265953M', po_norm='EN265953M'))

    rows = conn.execute(
        "SELECT * FROM shipments WHERE cliente_norm='ALTAR PRODUCE' AND unit_id_norm='GCXU8022816'"
    ).fetchall()
    assert len(rows) == 1
    assert result == 'updated'
    assert rows[0]['po'] == 'EN265953M'


def test_fresh_way_multi_po_per_container_not_merged(tmp_path):
    """Fresh Way legitimately has 2+ real POs for the same container — the
    no-po fallback must NOT collapse them into one row when both already
    have distinct POs."""
    conn = db_mod.init_db(str(tmp_path / 'test.db'))

    db_mod.upsert_shipment(conn, {
        'cliente': 'Fresh Way', 'cliente_norm': 'FRESH WAY', 'tipo_carga': 'ocean',
        'unit_id': 'FCONT123', 'unit_id_norm': 'FCONT123',
        'po': '10019-W', 'po_norm': '10019-W',
    })
    db_mod.upsert_shipment(conn, {
        'cliente': 'Fresh Way', 'cliente_norm': 'FRESH WAY', 'tipo_carga': 'ocean',
        'unit_id': 'FCONT123', 'unit_id_norm': 'FCONT123',
        'po': '10019-Y', 'po_norm': '10019-Y',
    })

    rows = conn.execute(
        "SELECT po FROM shipments WHERE cliente_norm='FRESH WAY' AND unit_id_norm='FCONT123'"
    ).fetchall()
    assert {r['po'] for r in rows} == {'10019-W', '10019-Y'}


def test_fresh_way_repeat_no_po_update_is_ambiguous_creates_new_row(tmp_path):
    """When a container already has 2+ distinct-PO rows and a new no-po
    record arrives, the match is ambiguous — must not guess, so it inserts
    a third row rather than silently merging into an arbitrary one."""
    conn = db_mod.init_db(str(tmp_path / 'test.db'))
    for po in ('10019-W', '10019-Y'):
        db_mod.upsert_shipment(conn, {
            'cliente': 'Fresh Way', 'cliente_norm': 'FRESH WAY', 'tipo_carga': 'ocean',
            'unit_id': 'FCONT123', 'unit_id_norm': 'FCONT123',
            'po': po, 'po_norm': po,
        })

    result = db_mod.upsert_shipment(conn, {
        'cliente': 'Fresh Way', 'cliente_norm': 'FRESH WAY', 'tipo_carga': 'ocean',
        'unit_id': 'FCONT123', 'unit_id_norm': 'FCONT123',
    })

    rows = conn.execute(
        "SELECT * FROM shipments WHERE cliente_norm='FRESH WAY' AND unit_id_norm='FCONT123'"
    ).fetchall()
    assert result == 'inserted'
    assert len(rows) == 3
