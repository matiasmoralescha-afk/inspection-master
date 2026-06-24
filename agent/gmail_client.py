"""
Gmail API client. Non-interactive — fails loudly if token is missing or expired.
Initial token must be generated locally via agent/auth_setup.py.
"""
import base64
import logging
import os
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]


def _load_credentials(token_file: str) -> Credentials:
    if not os.path.exists(token_file):
        raise FileNotFoundError(
            f'Gmail token not found at {token_file!r}. '
            'Run "python -m agent.auth_setup" locally first, then copy '
            'the resulting token file to this path on the VPS.'
        )
    creds = Credentials.from_authorized_user_file(token_file, _SCOPES)
    if creds.expired and creds.refresh_token:
        logger.info('Refreshing Gmail token...')
        creds.refresh(Request())
        with open(token_file, 'w') as f:
            f.write(creds.to_json())
    if not creds.valid:
        raise RuntimeError(
            f'Gmail token at {token_file!r} is invalid and could not be refreshed. '
            'Re-run auth_setup.py locally and copy the new token.'
        )
    return creds


def build_service(token_file: str):
    creds = _load_credentials(token_file)
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


def list_threads(service, query: str, max_results: int = 200) -> list[dict]:
    """Return all thread stubs matching the query (handles pagination)."""
    threads: list[dict] = []
    page_token = None

    while True:
        kwargs = {'userId': 'me', 'q': query, 'maxResults': min(max_results, 500)}
        if page_token:
            kwargs['pageToken'] = page_token

        resp = service.users().threads().list(**kwargs).execute()
        batch = resp.get('threads', [])
        threads.extend(batch)

        page_token = resp.get('nextPageToken')
        if not page_token or len(threads) >= max_results:
            break

    logger.info('list_threads found %d threads for query: %s', len(threads), query)
    return threads[:max_results]


def get_thread(service, thread_id: str) -> dict:
    """Fetch full thread with all messages (format=full)."""
    return service.users().threads().get(
        userId='me',
        id=thread_id,
        format='full',
    ).execute()


def get_message_body(message: dict) -> Optional[str]:
    """
    Extract the HTML body from a Gmail message dict.
    Prefers text/html. Returns None if no HTML part found.
    """
    payload = message.get('payload', {})
    return _extract_html_from_payload(payload)


def _extract_html_from_payload(payload: dict) -> Optional[str]:
    mime_type = payload.get('mimeType', '')
    body_data = payload.get('body', {}).get('data', '')

    if mime_type == 'text/html' and body_data:
        return base64.urlsafe_b64decode(body_data).decode('utf-8', errors='replace')

    # Recurse into multipart
    for part in payload.get('parts', []):
        result = _extract_html_from_payload(part)
        if result:
            return result

    return None


def get_message_date(message: dict) -> Optional[str]:
    """Return ISO datetime string from internalDate (milliseconds UTC)."""
    internal_date = message.get('internalDate')
    if not internal_date:
        return None
    from datetime import datetime, timezone
    ts = int(internal_date) / 1000
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
