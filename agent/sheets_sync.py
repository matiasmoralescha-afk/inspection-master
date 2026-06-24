"""
One-way sync: SQLite → Google Sheets.
Full overwrite of the target tab each run — the Sheet is a view, SQLite is the truth.
"""
import logging
import sqlite3

logger = logging.getLogger(__name__)

_COLUMNS = [
    ('cliente',                       'Cliente'),
    ('tipo_carga',                    'Modo'),
    ('unit_id',                       'Container#/AWB'),
    ('po',                            'PO'),
    ('commodity',                     'Commodity'),
    ('shipper',                       'Shipper'),
    ('country_of_origin',             'País Origen'),
    ('eta_fecha',                     'ETA'),
    ('vessel',                        'Buque/Línea'),
    ('bl',                            'BL#'),
    ('fda_status',                    'FDA'),
    ('agriculture_usda_status',       'USDA/Agriculture'),
    ('customs_status',                '10+2/Customs'),
    ('fumigation_status',             'Fumigación'),
    ('fumigation_completed_at',       'Fumig. Completada'),
    ('warehouse_arrival_confirmed',   'En Bodega'),
    ('warehouse_arrival_at',          'Llegada Bodega'),
    ('pallets',                       'Pallets'),
    ('overall_grade',                 'Overall Grade'),
    ('ready_for_inspection',          'Listo p/Inspección'),
    ('dia_disponible_para_inspeccion','Día Disponible'),
    ('inspection_status',             'Estado Inspección'),
    ('report_sent',                   'Reporte Enviado'),
    ('report_date',                   'Fecha Inspección'),
    ('report_url',                    'Link Reporte'),
    ('estado_general',                'Estado General'),
    ('psi_file',                      'PSI File'),
    ('comments_raw',                  'Comentarios'),
    ('ultima_actualizacion',          'Última Actualización'),
    ('fuente',                        'Fuente (thread:msg)'),
]

_BOOL_FIELDS = {'warehouse_arrival_confirmed', 'ready_for_inspection', 'report_sent'}


def sync(
    conn: sqlite3.Connection,
    sheet_id: str,
    token_file: str,
    tab_name: str = 'Vista Agente',
) -> int:
    """
    Write all shipments to Google Sheets. Returns number of data rows written.
    Errors are logged but do NOT raise — DB is the source of truth.
    """
    try:
        import gspread
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        _SCOPES = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ]
        creds = Credentials.from_authorized_user_file(token_file, _SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        gc = gspread.authorize(creds)
        sh = gc.open_by_key(sheet_id)

        try:
            ws = sh.worksheet(tab_name)
        except gspread.exceptions.WorksheetNotFound:
            ws = sh.add_worksheet(title=tab_name, rows=1000, cols=len(_COLUMNS))
            logger.info('Created new sheet tab: %s', tab_name)

        rows = conn.execute(
            "SELECT * FROM shipments ORDER BY "
            "CASE estado_general WHEN 'abierto' THEN 0 ELSE 1 END, "
            "ready_for_inspection DESC, eta_fecha ASC NULLS LAST"
        ).fetchall()

        db_fields = [c[0] for c in _COLUMNS]
        headers   = [c[1] for c in _COLUMNS]

        data = [headers]
        for row in rows:
            row_dict = dict(row)
            cells = []
            for field in db_fields:
                val = row_dict.get(field)
                if field in _BOOL_FIELDS:
                    val = 'Sí' if val else 'No'
                cells.append(val if val is not None else '')
            data.append(cells)

        ws.clear()
        ws.update('A1', data)
        ws.freeze(rows=1)

        written = len(data) - 1
        logger.info('Sheets sync: wrote %d rows to tab "%s"', written, tab_name)
        return written

    except Exception:
        logger.exception('Sheets sync failed — DB is unaffected')
        return 0
