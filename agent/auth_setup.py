"""
One-time OAuth setup. Run locally (not on the VPS).

Usage:
    python -m agent.auth_setup

Prerequisites:
    1. Create a project in Google Cloud Console.
    2. Enable Gmail API.
    3. Create an OAuth 2.0 Client ID (type: Desktop App).
    4. Download the JSON and save it as credentials/google-oauth-client.json.

After running this script:
    - credentials/gmail-token.json is created with a refresh token.
    - Copy that file to the VPS at the same relative path.
    - The agent will auto-refresh it on every run — no browser needed on the VPS.
"""
import os
import sys
from pathlib import Path

_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]
_OAUTH_CLIENT_FILE = 'credentials/google-oauth-client.json'
_TOKEN_FILE = 'credentials/gmail-token.json'


def main() -> None:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print('ERROR: google-auth-oauthlib not installed. Run: pip install google-auth-oauthlib')
        sys.exit(1)

    if not os.path.exists(_OAUTH_CLIENT_FILE):
        print(f'ERROR: OAuth client credentials not found at {_OAUTH_CLIENT_FILE!r}')
        print('Download from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs')
        sys.exit(1)

    print(f'Starting OAuth flow for scopes: {_SCOPES}')
    print('A browser window will open. Log in and authorize access.')

    flow = InstalledAppFlow.from_client_secrets_file(_OAUTH_CLIENT_FILE, _SCOPES)
    creds = flow.run_local_server(port=0)

    Path(_TOKEN_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(_TOKEN_FILE, 'w') as f:
        f.write(creds.to_json())

    print(f'\nToken saved to {_TOKEN_FILE!r}')
    print('Next steps:')
    print('  1. Copy credentials/gmail-token.json to the VPS.')
    print('  2. The agent will auto-refresh the token — no further manual steps needed.')


if __name__ == '__main__':
    main()
