-- Inspection Master — Supabase PostgreSQL schema
-- Run this in: https://supabase.com/dashboard/project/vrqkjzcmpnltkggbxonp/sql

create table if not exists shipments (
    id                              bigint generated always as identity primary key,

    -- Lookup key fields
    cliente_norm                    text not null,
    unit_id_norm                    text,
    po_norm                         text,

    -- Generated unique key
    lookup_key text generated always as (
        cliente_norm || '|' || coalesce(unit_id_norm, '') || '|' || coalesce(po_norm, '')
    ) stored not null,

    -- Canonical fields
    cliente                         text not null,
    tipo_carga                      text not null default 'ocean',
    location                        text,           -- Miami | Texas | Los Angeles
    po                              text,
    unit_id                         text,
    shipper                         text,
    country_of_origin               text,
    commodity                       text,
    eta_fecha                       text,
    eta_hora                        text,
    carrier                         text,
    vessel                          text,
    bl                              text,

    customs_status                  text,
    fda_status                      text,
    agriculture_usda_status         text,

    fumigation_status               text,
    fumigation_completed_at         text,

    warehouse_arrival_confirmed     integer not null default 0,
    warehouse_arrival_at            text,
    pallets                         integer,

    -- Derived
    requiere_fumigacion             integer,
    ready_for_inspection            integer not null default 0,
    dia_disponible_para_inspeccion  text,
    reinspection_due_date           text,   -- Altar TX: report_date + 4 days

    -- Inspection (from reports@eliteqa.app)
    inspection_status               text not null default 'pendiente',
    report_sent                     integer not null default 0,
    report_date                     text,
    report_url                      text,
    overall_grade                   text,
    condition_text                  text,
    quality_text                    text,

    estado_general                  text not null default 'abierto',

    -- Staff
    inspector_id                    bigint references staff(id),

    -- Meta
    ultima_actualizacion            text not null,
    fuente                          text,
    comments_raw                    text,
    psi_file                        text,
    quantity_description            text,
    lots_raw                        text,

    unique (lookup_key)
);

create table if not exists staff (
    id          bigint generated always as identity primary key,
    name        text not null,
    role        text not null check (role in ('inspector', 'editor', 'coordinator')),
    zone        text,               -- Miami | McAllen | Calexico | Los Angeles | Texas
    whatsapp    text,
    email       text,
    active      integer not null default 1,
    clients_assigned text,          -- JSON array: ["Alpine", "Fresh Way"]
    created_at  timestamptz not null default now()
);

alter table staff disable row level security;

create index if not exists idx_shipments_cliente_unit on shipments (cliente_norm, unit_id_norm);
create index if not exists idx_shipments_cliente_po on shipments (cliente_norm, po_norm);
create index if not exists idx_shipments_estado on shipments (estado_general);

create table if not exists notifications (
    id          bigint generated always as identity primary key,
    shipment_id bigint references shipments(id),
    event_type  text not null,  -- ready_for_inspection | reinspection_due | report_received | eta_overdue
    sent_at     timestamptz not null default now(),
    channels    text,           -- JSON: ["email","whatsapp","push"]
    message     text,
    -- Dedup: one notification per shipment+event per day
    unique (shipment_id, event_type, (sent_at::date))
);

alter table notifications disable row level security;

create table if not exists processed_messages (
    message_id   text primary key,
    thread_id    text not null,
    processed_at text not null
);

create table if not exists header_mapping_cache (
    headers_hash text primary key,
    mapping_json text not null,
    created_at   text not null
);

-- No RLS — internal tool, anon key reads freely
alter table shipments disable row level security;
alter table processed_messages disable row level security;
alter table header_mapping_cache disable row level security;
