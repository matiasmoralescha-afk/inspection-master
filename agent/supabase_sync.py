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
        return -1


def restore_shipments(conn: sqlite3.Connection, supabase_url: str, service_role_key: str) -> int:
    """
    Pull all existing shipments FROM Supabase into local SQLite, and prune any
    local row whose lookup_key no longer exists in Supabase (e.g. deleted from
    the dashboard). Call at startup in stateless environments (GitHub Actions)
    so derived fields can be recomputed across all shipments, not just those
    with emails in the current time window.

    Since this runs before any email is processed this run, the prune step
    only ever removes rows this run itself hasn't (re)created yet — so a
    dashboard delete is always honored on the next run, instead of being
    silently resurrected by the final full sync back to Supabase.
    """
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)

        # Fetch in pages to handle large datasets
        page_size = 500
        offset = 0
        total = 0

        # Columns that SQLite generates — must not be in INSERT
        skip_cols = {'id', 'lookup_key'}
        seen_lookup_keys: set[str] = set()

        while True:
            result = client.table('shipments').select('*').range(offset, offset + page_size - 1).execute()
            rows = result.data or []
            if not rows:
                break

            for row in rows:
                lookup_key = row.get('lookup_key')
                if lookup_key:
                    seen_lookup_keys.add(lookup_key)

                # Build an INSERT OR IGNORE so we don't clobber freshly-parsed data
                cols = {k: v for k, v in row.items() if k not in skip_cols and v is not None}
                if not cols:
                    continue
                placeholders = ', '.join(['?'] * len(cols))
                col_names = ', '.join(cols.keys())
                conn.execute(
                    f'INSERT OR IGNORE INTO shipments ({col_names}) VALUES ({placeholders})',
                    list(cols.values()),
                )
                total += 1

            offset += page_size
            if len(rows) < page_size:
                break

        # Prune local rows that no longer exist in Supabase. Guarded on a
        # non-empty Supabase result so a transient empty response can't wipe
        # out everything.
        if seen_lookup_keys:
            existing = {
                r['lookup_key'] for r in conn.execute('SELECT lookup_key FROM shipments').fetchall()
            }
            stale = existing - seen_lookup_keys
            if stale:
                conn.executemany(
                    'DELETE FROM shipments WHERE lookup_key = ?', [(k,) for k in stale],
                )
                logger.info('Pruned %d local shipment(s) no longer present in Supabase', len(stale))

        conn.commit()
        logger.info('Restored %d shipments from Supabase into SQLite', total)
        return total

    except Exception:
        logger.exception('Failed to restore shipments from Supabase — will only process recent emails')
        return -1


def recompute_derived_fields_in_supabase(
    supabase_url: str,
    service_role_key: str,
    clients_config: dict,
) -> int:
    """
    Directly update dia_disponible_para_inspeccion and reinspection_due_date
    in Supabase for all open shipments, without touching SQLite.

    Uses eta_fecha as fallback when fumigation_completed_at is not set.
    This ensures the dashboard always shows correct dates even in stateless runs
    where the local SQLite DB has no rows from recent emails.

    Returns number of rows updated.
    """
    try:
        from datetime import date, datetime, timedelta
        from supabase import create_client

        client = create_client(supabase_url, service_role_key)

        # Fetch all open shipments
        result = client.table('shipments').select(
            'id,lookup_key,cliente,eta_fecha,fumigation_completed_at,'
            'dia_disponible_para_inspeccion,reinspection_due_date,report_date'
        ).eq('estado_general', 'abierto').execute()

        rows = result.data or []
        logger.info('recompute_derived: fetched %d open shipments from Supabase', len(rows))

        updated = 0
        for row in rows:
            updates: dict = {}

            # --- dia_disponible_para_inspeccion ---
            fum_done = row.get('fumigation_completed_at')
            if fum_done:
                # Precise date from fumigation completion + cutoff
                try:
                    fum_dt = datetime.fromisoformat(fum_done)
                    cliente = row.get('cliente', '')
                    cutoff = None
                    for _k, cfg in clients_config.items():
                        if cfg['display_name'].lower() == cliente.lower():
                            cutoff = cfg.get('cutoff_hour')
                            break
                    if cutoff is not None and fum_dt.hour >= cutoff:
                        dia = (fum_dt + timedelta(days=1)).date().isoformat()
                    else:
                        dia = fum_dt.date().isoformat()
                    if dia != row.get('dia_disponible_para_inspeccion'):
                        updates['dia_disponible_para_inspeccion'] = dia
                except ValueError:
                    pass
            else:
                # Fallback: use eta_fecha — but only when it's actually a date.
                # Legacy rows carry raw text ("PENDING ESTIMATED...") in
                # eta_fecha; truncating that to 10 chars is how garbage like
                # 'PENDING ES' ended up in dia_disponible_para_inspeccion.
                eta = (row.get('eta_fecha') or '')[:10]
                try:
                    date.fromisoformat(eta)
                except ValueError:
                    eta = None
                if eta and eta != row.get('dia_disponible_para_inspeccion'):
                    updates['dia_disponible_para_inspeccion'] = eta

            # --- reinspection_due_date (Altar TX only) ---
            if 'altar' in (row.get('cliente') or '').lower():
                report_date = row.get('report_date')
                if report_date:
                    try:
                        due = (date.fromisoformat(report_date[:10]) + timedelta(days=4)).isoformat()
                        if due != row.get('reinspection_due_date'):
                            updates['reinspection_due_date'] = due
                    except ValueError:
                        pass

            if updates:
                client.table('shipments').update(updates).eq('id', row['id']).execute()
                updated += 1

        logger.info('recompute_derived: updated %d rows in Supabase', updated)
        return updated

    except Exception:
        logger.exception('recompute_derived_fields_in_supabase failed — non-fatal')
        return 0


def last_processed_at(supabase_url: str, service_role_key: str):
    """
    Timestamp (ISO string) of the most recently processed email in Supabase,
    or None. Used to size the Gmail search window adaptively: after an outage
    the next run widens automatically instead of skipping the gap.
    """
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)
        result = (
            client.table('processed_messages')
            .select('processed_at')
            .order('processed_at', desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0]['processed_at'] if rows else None
    except Exception:
        logger.exception('last_processed_at failed — falling back to widest window')
        return None


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
        return -1


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
