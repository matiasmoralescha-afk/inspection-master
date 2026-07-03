"""Tests for fresh_way, altar_lot, and sq1 parsers, based on real emails
observed in the ops inbox during the weeks of 2026-06-25 → 07-03."""
from agent.parsers import fresh_way as fw
from agent.parsers import altar_lot as al
from agent.parsers import alpine_lot as apl
from agent.parsers import sq1


# ── Fresh Way inspection requests ────────────────────────────────────

VEGLAND_BODY = """Buenos dias Equipo espero se encuentren bien
Por favor su gentil ayuda con la inspección del siguiente lote que
arribara a la bodega de Vegland el dia miércoles 07.01.

10120 DRAGON FRUIT 7/1/2026

Best Regards
"""

FOUREARTH_BODY = """Buenos días estimados, espero se encuentren bien
Solicito amablemente la inspección del siguiente lote que arribará
a la bodega de 4Earth el jueves 07.08.

10024 LYCHEE 7/8/2026 TEXAS 4EARTH

Best Regards
"""


def test_is_inspection_request_matches_real_subjects():
    assert fw.is_inspection_request('INSPECCION VEGLAND LOT 10120')
    assert fw.is_inspection_request('INSPECCION 4EARTH LOT 10024')
    assert fw.is_inspection_request('RE: INSPECCION VEGLAND LOT 10120')
    assert not fw.is_inspection_request('OCEAN UPDATE ALTAR PRODUCE 7/01')
    assert not fw.is_inspection_request('SQ1 Inspection Request')


def test_parse_vegland_request():
    r = fw.parse('INSPECCION VEGLAND LOT 10120', VEGLAND_BODY)
    assert r is not None
    assert r['lot_id'] == '10120'
    assert r['warehouse'] == 'VEGLAND'
    assert r['commodity_raw'] == 'Dragon Fruit'
    assert r['eta_fecha'] == '2026-07-01'
    # Sin keyword de ubicación en el cuerpo, la bodega la implica:
    # Vegland = Los Angeles (confirmado por ops 07/2026)
    assert r['location'] == 'Los Angeles'


def test_parse_4earth_request_with_location():
    r = fw.parse('INSPECCION 4EARTH LOT 10024', FOUREARTH_BODY)
    assert r is not None
    assert r['lot_id'] == '10024'
    assert r['warehouse'] == '4EARTH'
    assert r['commodity_raw'] == 'Lychee'
    assert r['eta_fecha'] == '2026-07-08'
    assert r['location'] == 'Texas'


def test_parse_returns_none_for_other_subjects():
    assert fw.parse('AIR UPDATE PRIME TIME INTL 07/02', 'whatever') is None


# ── Altar lot announcements ──────────────────────────────────────────

def test_is_altar_lot_matches_real_subjects():
    assert al.is_altar_lot('DC262004M // SMLU 5472542', 'melissa@altarproduce.com')
    assert al.is_altar_lot('CP260319M // ZMOU 8960111', 'Melissa V <melissa@altarproduce.com>')
    assert al.is_altar_lot('DC262006M // CAIU 5553715', 'melissa@altarproduce.com')


def test_is_altar_lot_rejects_recalls_and_other_senders():
    assert not al.is_altar_lot('Recall: DC262004M // SMLU 5472542', 'melissa@altarproduce.com')
    assert not al.is_altar_lot('DC262004M // SMLU 5472542', 'someone@example.com')
    assert not al.is_altar_lot('OCEAN UPDATE ALTAR PRODUCE 7/01', 'melissa@altarproduce.com')


def test_altar_parse_subject():
    r = al.parse_subject('DC262004M // SMLU 5472542')
    assert r == {'po': 'DC262004M', 'unit_id': 'SMLU 5472542'}

    r = al.parse_subject('RE: CP260319M // ZMOU 8960111')
    assert r == {'po': 'CP260319M', 'unit_id': 'ZMOU 8960111'}


def test_altar_packing_date():
    body = 'DC262004M SMLU 5472542 PACKING DATE 6.29 STD..1325 DS..940 TOTAL 2800'
    assert al.parse_packing_date(body, 2026) == '2026-06-29'
    assert al.parse_packing_date('no date here', 2026) is None


# ── Alpine LA lot requests from Carlos Gallo (confirmed by ops 07/2026) ──
# Every "LOT X PO Y" from alpinefresh.com is an LA inspection request that
# must end in a report; reports use the combined "PO//LOT" format.

def test_alpine_lot_matches_carlos_subjects():
    assert apl.is_alpine_lot('LOT CARRIL011 PO 92364', 'cgallo@alpinefresh.com')
    assert apl.is_alpine_lot('LOT UNIOAG029 PO 92218', 'Carlos Gallo <cgallo@alpinefresh.com>')
    assert apl.is_alpine_lot('RE: LOT CARRIL010 PO 92323', 'cgallo@alpinefresh.com')


def test_alpine_lot_rejects_other_senders_and_subjects():
    # Same subject from LCX (warehouse reply) or unrelated senders: not a request
    assert not apl.is_alpine_lot('RE: LOT CARRIL010 PO 92323', 'azarate@lcxfresh.com')
    assert not apl.is_alpine_lot('ALPINE FRESH | ASPARAGUS OCEAN REPORT', 'cgallo@alpinefresh.com')
    assert not apl.is_alpine_lot('Re: Inspection Report — Asparagus | PO 92283//OK0017', 'rgomes@alpinefresh.com')


def test_alpine_lot_parse_subject_builds_combined_po():
    r = apl.parse_subject('LOT CARRIL011 PO 92364')
    assert r == {'lot': 'CARRIL011', 'po': '92364', 'po_combined': '92364//CARRIL011'}


# ── Square One: location per request format (confirmed by ops 07/2026) ──
# Transkool (Laurence Baca) = McAllen, Texas. Angelica Alvarez = Miami.

ANGELICA_BODY = """Hi Samy and Team,
We have these lots arriving at the warehouse today.
TA-0529B/TXGU9030529
DTS-5273B/GCXU8015273
Best Regards,
Angelica Alvarez
"""


def test_sq1_transkool_subject_is_texas():
    rows = sq1.parse(
        'SQ1 Inspection Request - Transkool - ETA 7/3  LOT ID MFB-0226', '',
    )
    assert len(rows) == 1
    assert rows[0]['lot_id'] == 'MFB-0226'
    assert rows[0]['location'] == 'Texas'
    assert rows[0]['eta_fecha'] == '2026-07-03'


def test_sq1_angelica_body_is_miami():
    rows = sq1.parse('SQ1 Inspection Request', ANGELICA_BODY)
    lots = {r['lot_id']: r for r in rows}
    assert set(lots) == {'TA-0529B', 'DTS-5273B'}
    assert all(r['location'] == 'Miami' for r in rows)
    assert lots['TA-0529B']['unit_id'] == 'TXGU9030529'
    assert lots['DTS-5273B']['unit_id'] == 'GCXU8015273'


def test_sq1_reply_add_lot_is_miami():
    # Angelica adds lots by replying to the same thread ("Add <lot>/<container>")
    rows = sq1.parse('Re: SQ1 Inspection Request', 'Add AGP-5572B/ SEGU9885572')
    assert len(rows) == 1
    assert rows[0]['lot_id'] == 'AGP-5572B'
    assert rows[0]['unit_id'] == 'SEGU9885572'
    assert rows[0]['location'] == 'Miami'
