"""
Send a WhatsApp alert when the scheduled GitHub Actions run fails.

Called from .github/workflows/run-agent.yml's `if: failure()` step. Uses
Twilio only (not the Gmail-based email channel) since an expired/invalid
Gmail token is one of the likely reasons the run failed in the first place —
an email alert would silently fail for the same reason.

Usage:
    python -m agent.notify_failure "https://github.com/OWNER/REPO/actions/runs/12345"
"""
import sys

from dotenv import load_dotenv

from agent import notifications as notif

load_dotenv()


def main() -> None:
    run_url = sys.argv[1] if len(sys.argv) > 1 else ''
    message = '🔴 El agente de inspecciones falló en su corrida programada.'
    if run_url:
        message += f'\n{run_url}'

    sent = notif.send_ops_alert(message)
    if not sent:
        print('Failure alert not sent (NOTIFY_WHATSAPP not configured, or Twilio send failed)',
              file=sys.stderr)


if __name__ == '__main__':
    main()
