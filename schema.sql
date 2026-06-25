CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Lookup key fields
    cliente_norm    TEXT NOT NULL,
    unit_id_norm    TEXT,           -- container/AWB, NULL for terrestrial DELIVERY loads
    po_norm         TEXT,           -- NULL until inspection report arrives; part of key for Fresh Way

    -- Generated unique key: handles alpine-no-PO, fresh-way-multi-PO, and terrestrial-no-container
    -- "ALTAR PRODUCE|ZMOU8967899|"           ← ocean update, no PO yet
    -- "ALTAR PRODUCE|ZMOU8967899|PHA261958M" ← after inspection report updates PO
    -- "FRESH WAY|FCONT123|10019-W"           ← Fresh Way row 1
    -- "FRESH WAY|FCONT123|10019-Y"           ← Fresh Way row 2 (same container, diff PO)
    -- "FRESH WAY||10112"                     ← terrestrial DELIVERY load
    lookup_key TEXT GENERATED ALWAYS AS (
        cliente_norm || '|' || COALESCE(unit_id_norm, '') || '|' || COALESCE(po_norm, '')
    ) STORED NOT NULL,

    -- Canonical fields
    cliente                 TEXT NOT NULL,
    tipo_carga              TEXT NOT NULL DEFAULT 'ocean',
    location                TEXT,           -- Miami | Texas | Los Angeles
    po                      TEXT,
    unit_id                 TEXT,
    shipper                 TEXT,
    country_of_origin       TEXT,
    commodity               TEXT,
    eta_fecha               TEXT,           -- YYYY-MM-DD
    eta_hora                TEXT,
    carrier                 TEXT,
    vessel                  TEXT,
    bl                      TEXT,           -- Bill of Lading number

    customs_status          TEXT,
    fda_status              TEXT,
    agriculture_usda_status TEXT,

    fumigation_status       TEXT,
    fumigation_completed_at TEXT,

    warehouse_arrival_confirmed INTEGER NOT NULL DEFAULT 0,
    warehouse_arrival_at        TEXT,
    pallets                     INTEGER,

    -- Derived (recalculated each run)
    requiere_fumigacion             INTEGER,
    ready_for_inspection            INTEGER NOT NULL DEFAULT 0,
    dia_disponible_para_inspeccion  TEXT,
    reinspection_due_date           TEXT,   -- Altar TX: report_date + 4 days

    -- Inspection (set from reports@eliteqa.app emails)
    inspection_status       TEXT NOT NULL DEFAULT 'pendiente',
    report_sent             INTEGER NOT NULL DEFAULT 0,
    report_date             TEXT,
    report_url              TEXT,
    overall_grade           TEXT,
    condition_text          TEXT,
    quality_text            TEXT,

    estado_general          TEXT NOT NULL DEFAULT 'abierto',

    -- Staff
    inspector_id         INTEGER REFERENCES staff(id),

    -- Meta
    ultima_actualizacion TEXT NOT NULL,
    fuente               TEXT,
    comments_raw         TEXT,
    psi_file             TEXT,
    quantity_description TEXT,
    lots_raw             TEXT,

    UNIQUE (lookup_key)
);

CREATE INDEX IF NOT EXISTS idx_shipments_cliente_unit
    ON shipments (cliente_norm, unit_id_norm);

CREATE INDEX IF NOT EXISTS idx_shipments_cliente_po
    ON shipments (cliente_norm, po_norm);

CREATE TABLE IF NOT EXISTS staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('inspector', 'editor', 'coordinator')),
    zone        TEXT,               -- Miami | McAllen | Calexico | Los Angeles | Texas
    whatsapp    TEXT,
    email       TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    clients_assigned TEXT,          -- JSON array: ["Alpine", "Fresh Way"]
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER REFERENCES shipments(id),
    event_type  TEXT NOT NULL,  -- ready_for_inspection | reinspection_due | report_received | eta_overdue
    sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
    channels    TEXT,           -- JSON: ["email","whatsapp","push"]
    message     TEXT,
    -- Dedup: one notification per shipment+event per day
    UNIQUE (shipment_id, event_type, date(sent_at))
);

CREATE TABLE IF NOT EXISTS processed_messages (
    message_id   TEXT PRIMARY KEY,
    thread_id    TEXT NOT NULL,
    processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS header_mapping_cache (
    headers_hash TEXT PRIMARY KEY,
    mapping_json TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
