"""
Sync SQLite → Supabase (PostgreSQL).
Full upsert of all shipments each run — Supabase is a read replica for the web app.
"""
import logging
import sqlite3

logger = logging.getLogger(__name__)

# Generated/auto columns that must not be sent in INSERT/UPSERT
_EXCLUDED = {'id', 'lookup_key'}


def sync(conn: sqlite3.Connection, supabase_url: str, service_role_key: str) -> int:
    """
    Upsert all shipments from SQLite into Supabase.
    Returns number of rows synced, or 0 on error.
    """
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)

        rows = conn.execute(
            "SELECT * FROM shipments ORDER BY eta_fecha ASC NULLS LAST"
        ).fetchall()

        if not rows:
            logger.info('Supabase sync: nothing to sync')
            return 0

        data = []
        for row in rows:
            row_dict = dict(row)
            for col in _EXCLUDED:
                row_dict.pop(col, None)
            data.append(row_dict)

        # Upsert in batches of 500 to stay within PostgREST limits
        batch_size = 500
        total = 0
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            client.table('shipments').upsert(
                batch,
                on_conflict='lookup_key',
            ).execute()
            total += len(batch)

        logger.info('Supabase sync: upserted %d rows', total)
        return total

    except Exception:
        logger.exception('Supabase sync failed — DB is unaffected')
        return 0


def restore_processed_messages(conn: sqlite3.Connection, supabase_url: str, service_role_key: str) -> int:
    """
    Pull processed_messages FROM Supabase into local SQLite.
    Call at startup in stateless environments (GitHub Actions) so the agent
    doesn't re-process emails it already handled in previous runs.
    """
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)

        result = client.table('processed_messages').select('*').execute()
        rows = result.data or []
        if not rows:
            return 0

        conn.executemany(
            'INSERT OR IGNORE INTO processed_messages (message_id, thread_id, processed_at) VALUES (?, ?, ?)',
            [(r['message_id'], r['thread_id'], r['processed_at']) for r in rows],
        )
        conn.commit()
        logger.info('Restored %d processed_messages from Supabase', len(rows))
        return len(rows)

    except Exception:
        logger.exception('Failed to restore processed_messages from Supabase — will reprocess recent emails')
        return 0


def sync_processed_messages(conn: sqlite3.Connection, supabase_url: str, service_role_key: str) -> None:
    """Sync processed_messages so the agent doesn't re-process emails when switching machines."""
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)

        rows = conn.execute("SELECT * FROM processed_messages").fetchall()
        if not rows:
            return

        data = [dict(r) for r in rows]
        for i in range(0, len(data), 500):
            client.table('processed_messages').upsert(
                data[i:i + 500],
                on_conflict='message_id',
            ).execute()

    except Exception:
        logger.exception('Supabase processed_messages sync failed')
