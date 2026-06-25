"""
Notification system for inspection state changes.

Supported channels: email (Gmail API) + WhatsApp (Twilio)
Supabase Realtime handles push notifications in the dashboard
by listening to the `notifications` table for new inserts.

Events:
  ready_for_inspection  — ready_for_inspection flipped to 1
  report_received       — report_sent flipped to 1 (inspection done)
  reinspection_due      — reinspection_due_date <= today
  eta_overdue           — eta_fecha <= today AND estado_general = 'abierto'

Deduplication: one notification per (shipment_id, event_type) per calendar day
is enforced at the DB level (UNIQUE constraint) and checked before sending.
"""
import base64
import json
import logging
import os
from datetime import date
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _notify_emails() -> list[str]:
    """Comma-separated NOTIFY_EMAILS env var → list of addresses."""
    raw = os.getenv('NOTIFY_EMAILS', '')
    return [e.strip() for e in raw.split(',') if e.strip()]


def _notify_whatsapp() -> list[str]:
    """Comma-separated NOTIFY_WHATSAPP env var → list of numbers (with country code)."""
    raw = os.getenv('NOTIFY_WHATSAPP', '')
    return [n.strip() for n in raw.split(',') if n.strip()]


def _twilio_client():
    """Return initialised Twilio client or None if not configured."""
    try:
        from twilio.rest import Client
        sid   = os.getenv('TWILIO_ACCOUNT_SID')
        token = os.getenv('TWILIO_AUTH_TOKEN')
        if not sid or not token:
            logger.warning('Twilio not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
            return None
        return Client(sid, token)
    except ImportError:
        logger.warning('twilio package not installed — WhatsApp notifications disabled')
        return None


# ---------------------------------------------------------------------------
# Channel: WhatsApp via Twilio
# ---------------------------------------------------------------------------

def _send_whatsapp(message: str) -> bool:
    """Send WhatsApp message to all NOTIFY_WHATSAPP recipients. Returns True if all sent."""
    client = _twilio_client()
    if not client:
        return False

    from_number = os.getenv('TWILIO_WHATSAPP_FROM', '')
    if not from_number.startswith('whatsapp:'):
        from_number = f'whatsapp:{from_number}'

    recipients = _notify_whatsapp()
    if not recipients:
        logger.warning('NOTIFY_WHATSAPP is empty — no WhatsApp notifications sent')
        return False

    success = True
    for number in recipients:
        to = number if number.startswith('whatsapp:') else f'whatsapp:{number}'
        try:
            msg = client.messages.create(body=message, from_=from_number, to=to)
            logger.info('WhatsApp sent to %s — SID %s', number, msg.sid)
        except Exception as exc:
            logger.error('WhatsApp to %s failed: %s', number, exc)
            success = False
    return success


# ---------------------------------------------------------------------------
# Channel: Email via Gmail API
# ---------------------------------------------------------------------------

def _send_email(gmail_service, subject: str, body: str) -> bool:
    """Send email to all NOTIFY_EMAILS recipients. Returns True if all sent."""
    recipients = _notify_emails()
    if not recipients:
        logger.warning('NOTIFY_EMAILS is empty — no email notifications sent')
        return False

    if gmail_service is None:
        logger.warning('Gmail service not available — skipping email notifications')
        return False

    success = True
    for recipient in recipients:
        try:
            mime = MIMEText(body, 'plain', 'utf-8')
            mime['to']      = recipient
            mime['subject'] = subject
            raw = base64.urlsafe_b64encode(mime.as_bytes()).decode()
            gmail_service.users().messages().send(
                userId='me', body={'raw': raw}
            ).execute()
            logger.info('Email sent to %s — subject: %s', recipient, subject)
        except Exception as exc:
            logger.error('Email to %s failed: %s', recipient, exc)
            success = False
    return success


# ---------------------------------------------------------------------------
# DB: dedup check + insert
# ---------------------------------------------------------------------------

def _already_notified(db_conn, shipment_id: int, event_type: str) -> bool:
    """Return True if a notification for this shipment+event was already sent today."""
    today = date.today().isoformat()
    row = db_conn.execute(
        "SELECT id FROM notifications "
        "WHERE shipment_id = ? AND event_type = ? AND date(sent_at) = ?",
        (shipment_id, event_type, today),
    ).fetchone()
    return row is not None


def _record_notification(db_conn, shipment_id: int, event_type: str,
                          channels: list[str], message: str) -> None:
    """Insert a notification record (dedup enforced by UNIQUE constraint)."""
    try:
        db_conn.execute(
            "INSERT OR IGNORE INTO notifications (shipment_id, event_type, channels, message) "
            "VALUES (?, ?, ?, ?)",
            (shipment_id, event_type, json.dumps(channels), message),
        )
        db_conn.commit()
    except Exception as exc:
        logger.error('Failed to record notification: %s', exc)


# ---------------------------------------------------------------------------
# Message builders
# ---------------------------------------------------------------------------

def _fmt_shipment(shipment: dict) -> str:
    """One-line summary of a shipment for notification messages."""
    client   = shipment.get('cliente', '?')
    unit     = shipment.get('unit_id') or shipment.get('po') or '?'
    commodity = shipment.get('commodity', '')
    eta      = shipment.get('eta_fecha', '')
    parts = [client, unit]
    if commodity:
        parts.append(commodity)
    if eta:
        parts.append(f'ETA {eta}')
    return ' | '.join(parts)


def _build_message(event_type: str, shipment: dict) -> tuple[str, str]:
    """Return (subject, body) for email and WhatsApp text."""
    summary = _fmt_shipment(shipment)
    reinsp  = shipment.get('reinspection_due_date', '')

    messages = {
        'ready_for_inspection': (
            f'🟢 Listo para inspección — {summary}',
            f'El contenedor ya está listo para inspección.\n{summary}',
        ),
        'report_received': (
            f'✅ Reporte recibido — {summary}',
            f'Se recibió el reporte de inspección.\n{summary}',
        ),
        'reinspection_due': (
            f'⚠️ Reinspección vence hoy — {summary}',
            f'La reinspección vence hoy ({reinsp}).\n{summary}',
        ),
        'eta_overdue': (
            f'🔴 ETA pasada sin inspeccionar — {summary}',
            f'La ETA ya pasó y el contenedor sigue abierto.\n{summary}',
        ),
    }
    return messages.get(event_type, (f'Notificación: {event_type}', summary))


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def check_and_notify(
    shipment: dict,
    prev_state: Optional[dict],
    db_conn,
    gmail_service=None,
) -> None:
    """
    Check if shipment triggers any notification events and dispatch them.

    Args:
        shipment:      Current shipment dict (post-upsert).
        prev_state:    Previous shipment state dict before upsert, or None if new.
        db_conn:       SQLite connection (for dedup checks + recording).
        gmail_service: Gmail API service object (optional, for email channel).
    """
    shipment_id = shipment.get('id')
    if not shipment_id:
        return

    today = date.today().isoformat()
    events_to_check: list[str] = []

    # Transition events — only fire when we have a previous state to compare against
    if prev_state is not None:
        prev_ready = prev_state.get('ready_for_inspection', 0)
        if shipment.get('ready_for_inspection') == 1 and prev_ready != 1:
            events_to_check.append('ready_for_inspection')

        prev_report = prev_state.get('report_sent', 0)
        if shipment.get('report_sent') == 1 and prev_report != 1:
            events_to_check.append('report_received')

    # Persistent-state events — checked on every run (daily scan + live upserts)
    reinsp_due = shipment.get('reinspection_due_date')
    if reinsp_due and reinsp_due <= today and shipment.get('estado_general') == 'abierto':
        events_to_check.append('reinspection_due')

    eta = shipment.get('eta_fecha')
    if (
        eta
        and eta < today
        and shipment.get('estado_general') == 'abierto'
        and not shipment.get('report_date')
    ):
        events_to_check.append('eta_overdue')

    for event_type in events_to_check:
        if _already_notified(db_conn, shipment_id, event_type):
            logger.debug('Already notified %s/%s today — skipping', shipment_id, event_type)
            continue

        subject, body = _build_message(event_type, shipment)
        channels_sent: list[str] = []

        # WhatsApp
        if _notify_whatsapp():
            if _send_whatsapp(body):
                channels_sent.append('whatsapp')

        # Email
        if _notify_emails():
            if _send_email(gmail_service, subject, body):
                channels_sent.append('email')

        # Always record (Supabase Realtime picks this up for dashboard push)
        channels_sent.append('push')
        _record_notification(db_conn, shipment_id, event_type, channels_sent, body)
        logger.info('Notification dispatched: %s for shipment %s via %s',
                    event_type, shipment_id, channels_sent)
