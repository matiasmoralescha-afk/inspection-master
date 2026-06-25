from datetime import datetime, date, timedelta
from typing import Optional

# Phrases that confirm fumigation is COMPLETE (whitelist — anything not here is False)
_FUMIGATION_COMPLETE_PHRASES = [
    'fumigation completed',
    'fumigation complete',
    'fumigate completed',
    'fumigated',
    'released from fumigation',
    'ready for pickup',
    'fumigation released',
    'cleared fumigation',
]

# Phrases that indicate fumigation is required but NOT yet done
_FUMIGATION_REQUIRED_PHRASES = [
    'required',
    'needed',
    'pending fumig',
    'under fumig',
    'scheduled for fumig',
    'in fumig',
    'at fumig',
    'fumigation hold',
]

_FUMIGATION_NOT_REQUIRED_PHRASES = [
    'not required',
    'no fumig',
    'waived',
    'exempt',
    'n/a',
]


def requires_fumigation(
    commodity_norm: Optional[str],
    country_of_origin: Optional[str],
    fumigation_status_raw: Optional[str],
    rules: list[dict],
) -> bool:
    """
    Section 4.2 — three-step logic:
    1. Explicit field value in fumigation_status.
    2. fumigation_rules.yaml table (commodity + country).
    3. Default False.
    """
    if fumigation_status_raw:
        text = fumigation_status_raw.lower()
        # Check negation first — "NOT REQUIRED" contains "required", order matters
        if any(p in text for p in _FUMIGATION_NOT_REQUIRED_PHRASES):
            return False
        if any(p in text for p in _FUMIGATION_REQUIRED_PHRASES):
            return True
        # Completed phrases imply it was required (and is now done)
        if any(p in text for p in _FUMIGATION_COMPLETE_PHRASES):
            return True

    if commodity_norm and country_of_origin:
        c = commodity_norm.lower()
        co = country_of_origin.lower()
        for rule in rules:
            if rule['commodity'].lower() == c and rule['country_of_origin'].lower() == co:
                return bool(rule['requires'])

    return False


def fumigation_is_completed(fumigation_status_raw: Optional[str]) -> bool:
    """
    Section 4.2 — only True for explicit confirmation phrases.
    Never infer completion from scheduling, presence at facility, or listing.
    """
    if not fumigation_status_raw:
        return False
    text = fumigation_status_raw.lower()
    return any(p in text for p in _FUMIGATION_COMPLETE_PHRASES)


def get_available_date(fumigation_completed_at: datetime, cutoff_hour: int) -> date:
    """
    Section 4.5 — if fumigation completed at/after cutoff_hour, available next day.
    """
    if fumigation_completed_at.hour >= cutoff_hour:
        return (fumigation_completed_at + timedelta(days=1)).date()
    return fumigation_completed_at.date()


def calc_ready_for_inspection(shipment: dict, _clients_config: dict) -> bool:
    """
    Sections 4.3 + 4.5.
    ready_for_inspection is True only when:
    - warehouse_arrival_confirmed is True, AND
    - if fumigation required: fumigation_completed_at has a value
    The cutoff rule (4.5) adjusts dia_disponible_para_inspeccion, not this flag.
    """
    # Inspection report arrival always overrides
    if shipment.get('inspection_status') == 'completada':
        return True

    if not shipment.get('warehouse_arrival_confirmed'):
        return False

    req_fum = shipment.get('requiere_fumigacion')
    if req_fum:
        return bool(shipment.get('fumigation_completed_at'))

    return True


def calc_reinspection_due_date(shipment: dict, clients_config: dict) -> Optional[str]:
    """
    Altar TX rule: every 4-5 days from the Elite report_date.
    Returns YYYY-MM-DD of the next reinspection due date, or None if not applicable.
    Only applies to Altar Produce shipments that have a report_date.
    """
    cliente = shipment.get('cliente', '')
    # Only Altar Produce
    if 'altar' not in cliente.lower():
        return None

    report_date_str = shipment.get('report_date')
    if not report_date_str:
        return None

    try:
        report_dt = date.fromisoformat(report_date_str[:10])
    except ValueError:
        return None

    # Due 4 days after the report (the window is 4-5 days, we alert at day 4)
    due = report_dt + timedelta(days=4)
    return due.isoformat()


def calc_dia_disponible(shipment: dict, clients_config: dict) -> Optional[str]:
    """
    Section 4.5 — calculate dia_disponible_para_inspeccion applying cutoff rule.
    Returns YYYY-MM-DD string or None.
    """
    fum_completed_at_str = shipment.get('fumigation_completed_at')
    if not fum_completed_at_str:
        return None

    try:
        fum_dt = datetime.fromisoformat(fum_completed_at_str)
    except ValueError:
        return None

    cliente = shipment.get('cliente', '')
    cutoff_hour = None
    for _key, cfg in clients_config.items():
        if cfg['display_name'].lower() == cliente.lower():
            cutoff_hour = cfg.get('cutoff_hour')
            break

    if cutoff_hour is not None:
        available = get_available_date(fum_dt, cutoff_hour)
    else:
        available = fum_dt.date()

    return available.isoformat()
