"""Tests for the self-healing Gmail window (compute_auto_window_hours)."""
from datetime import datetime, timedelta, timezone

from agent.main import compute_auto_window_hours

NOW = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)


def _iso(hours_ago: float) -> str:
    return (NOW - timedelta(hours=hours_ago)).isoformat()


def test_recent_run_uses_minimum_window():
    # Última corrida hace 1h → gap 1h + 2h margen = 3h → clamp al mínimo 4h
    assert compute_auto_window_hours(_iso(1), NOW) == 4


def test_outage_widens_the_window():
    # Caída de 36h (caso real 07/2026) → 36 + 2 = 38h, no se pierde nada
    assert compute_auto_window_hours(_iso(36), NOW) == 38


def test_long_outage_caps_at_14_days():
    assert compute_auto_window_hours(_iso(30 * 24), NOW) == 14 * 24


def test_no_history_uses_widest_window():
    assert compute_auto_window_hours(None, NOW) == 14 * 24


def test_unparseable_timestamp_uses_widest_window():
    assert compute_auto_window_hours('garbage', NOW) == 14 * 24


def test_zulu_suffix_is_accepted():
    iso_z = (NOW - timedelta(hours=10)).isoformat().replace('+00:00', 'Z')
    assert compute_auto_window_hours(iso_z, NOW) == 12


def test_naive_timestamp_assumed_utc():
    naive = (NOW - timedelta(hours=10)).replace(tzinfo=None).isoformat()
    assert compute_auto_window_hours(naive, NOW) == 12
