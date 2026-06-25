-- Migration 002: Add staff table and inspector_id to shipments
-- Run in: https://supabase.com/dashboard/project/vrqkjzcmpnltkggbxonp/sql

-- 1. Staff table
create table if not exists staff (
    id               bigint generated always as identity primary key,
    name             text not null,
    role             text not null check (role in ('inspector', 'editor', 'coordinator')),
    zone             text,           -- Miami | McAllen | Calexico | Los Angeles | Texas
    whatsapp         text,
    email            text,
    active           integer not null default 1,
    clients_assigned text,           -- JSON array: ["Alpine", "Fresh Way"]
    created_at       timestamptz not null default now()
);

alter table staff disable row level security;

-- 2. Link inspectors to shipments
alter table shipments
    add column if not exists inspector_id bigint references staff(id);

-- 3. Seed — inspectors and editors known from operations
insert into staff (name, role, zone, clients_assigned) values
    ('Freddy Solano',        'inspector',   'Miami',    '["Alpine","Fresh Way","Fruveg","Prime Time"]'),
    ('Miguel Angel Cardoso', 'inspector',   'Miami',    '["Alpine","Prime Time","Baja Son","Robinson"]'),
    ('Claudeth',             'inspector',   'McAllen',  '["Square One","Megafreso","Organic King"]'),
    ('Ronaldo',              'inspector',   'McAllen',  '["Altar"]'),
    ('Idalberto Meneses',    'inspector',   'Miami',    '["Square One"]'),
    ('Lizardo',              'coordinator', 'Calexico', '["Altar"]'),
    ('Rafa Torres',          'editor',      null,       '[]'),
    ('Marite',               'editor',      null,       '[]')
on conflict do nothing;
