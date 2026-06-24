import unittest
from datetime import datetime
from agent.business_rules import (
    requires_fumigation,
    fumigation_is_completed,
    get_available_date,
    calc_ready_for_inspection,
)

_FUM_RULES = [
    {'commodity': 'asparagus', 'country_of_origin': 'peru', 'requires': True},
]

_ALPINE_CONFIG = {
    'alpine_fresh': {
        'display_name': 'Alpine Fresh',
        'cutoff_hour': 19,
    }
}


class TestRequiresFumigation(unittest.TestCase):
    def test_asparagus_peru_requires(self):
        self.assertTrue(requires_fumigation('Asparagus', 'PERU', None, _FUM_RULES))

    def test_case_insensitive_match(self):
        self.assertTrue(requires_fumigation('asparagus', 'peru', None, _FUM_RULES))

    def test_unknown_combo_default_false(self):
        self.assertFalse(requires_fumigation('Limes', 'MEXICO', None, _FUM_RULES))

    def test_explicit_required_in_status(self):
        self.assertTrue(requires_fumigation('Limes', 'MEXICO', 'FUMIGATION REQUIRED', _FUM_RULES))

    def test_explicit_not_required_in_status(self):
        self.assertFalse(requires_fumigation('Asparagus', 'PERU', 'NOT REQUIRED', _FUM_RULES))

    def test_completed_phrase_implies_required(self):
        # "fumigation completed" means it was required (and now done)
        self.assertTrue(requires_fumigation('Asparagus', 'PERU', 'FUMIGATION COMPLETED', _FUM_RULES))


class TestFumigationIsCompleted(unittest.TestCase):
    def test_completed_phrase(self):
        self.assertTrue(fumigation_is_completed('FUMIGATION COMPLETED'))

    def test_released_from_fumigation(self):
        self.assertTrue(fumigation_is_completed('RELEASED FROM FUMIGATION'))

    def test_fumigated(self):
        self.assertTrue(fumigation_is_completed('FUMIGATED'))

    def test_ready_for_pickup(self):
        self.assertTrue(fumigation_is_completed('READY FOR PICKUP'))

    def test_pending_is_not_completed(self):
        self.assertFalse(fumigation_is_completed('PENDING FUMIGATION'))

    def test_in_facility_is_not_completed(self):
        self.assertFalse(fumigation_is_completed('AT FUMIGATION FACILITY'))

    def test_required_is_not_completed(self):
        self.assertFalse(fumigation_is_completed('FUMIGATION REQUIRED'))

    def test_none_is_false(self):
        self.assertFalse(fumigation_is_completed(None))

    def test_empty_is_false(self):
        self.assertFalse(fumigation_is_completed(''))


class TestGetAvailableDate(unittest.TestCase):
    """Section 4.5 — Alpine Fresh cutoff at 19:00."""

    def test_before_cutoff_same_day(self):
        dt = datetime(2026, 6, 20, 18, 30)   # 6:30 PM
        result = get_available_date(dt, cutoff_hour=19)
        self.assertEqual(result.isoformat(), '2026-06-20')

    def test_at_cutoff_next_day(self):
        dt = datetime(2026, 6, 20, 19, 0)    # exactly 7:00 PM
        result = get_available_date(dt, cutoff_hour=19)
        self.assertEqual(result.isoformat(), '2026-06-21')

    def test_after_cutoff_next_day(self):
        dt = datetime(2026, 6, 20, 21, 0)    # 9:00 PM
        result = get_available_date(dt, cutoff_hour=19)
        self.assertEqual(result.isoformat(), '2026-06-21')

    def test_midnight_edge(self):
        dt = datetime(2026, 6, 20, 0, 0)     # midnight = same day
        result = get_available_date(dt, cutoff_hour=19)
        self.assertEqual(result.isoformat(), '2026-06-20')


class TestCalcReadyForInspection(unittest.TestCase):
    def _shipment(self, **kwargs) -> dict:
        base = {
            'warehouse_arrival_confirmed': 0,
            'requiere_fumigacion': 0,
            'fumigation_completed_at': None,
            'inspection_status': 'pendiente',
        }
        base.update(kwargs)
        return base

    def test_not_ready_without_warehouse(self):
        s = self._shipment(warehouse_arrival_confirmed=0)
        self.assertFalse(calc_ready_for_inspection(s, {}))

    def test_ready_no_fumigation(self):
        s = self._shipment(warehouse_arrival_confirmed=1, requiere_fumigacion=0)
        self.assertTrue(calc_ready_for_inspection(s, {}))

    def test_not_ready_fumigation_required_but_not_completed(self):
        s = self._shipment(
            warehouse_arrival_confirmed=1,
            requiere_fumigacion=1,
            fumigation_completed_at=None,
        )
        self.assertFalse(calc_ready_for_inspection(s, {}))

    def test_ready_fumigation_required_and_completed(self):
        s = self._shipment(
            warehouse_arrival_confirmed=1,
            requiere_fumigacion=1,
            fumigation_completed_at='2026-06-20T15:00:00+00:00',
        )
        self.assertTrue(calc_ready_for_inspection(s, {}))

    def test_inspection_completada_always_ready(self):
        s = self._shipment(
            warehouse_arrival_confirmed=0,
            inspection_status='completada',
        )
        self.assertTrue(calc_ready_for_inspection(s, {}))


if __name__ == '__main__':
    unittest.main()
