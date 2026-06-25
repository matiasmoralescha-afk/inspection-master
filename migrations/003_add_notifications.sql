-- Migration 003: Add notifications table
-- Run in: https://supabase.com/dashboard/project/vrqkjzcmpnltkggbxonp/sql

create table if not exists notifications (
    id          bigint generated always as identity primary key,
    shipment_id bigint references shipments(id),
    event_type  text not null,
    sent_at     timestamptz not null default now(),
    channels    text,
    message     text,
    unique (shipment_id, event_type, (sent_at::date))
);

alter table notifications disable row level security;

-- Enable Supabase Realtime on this table (required for dashboard push toasts)
-- Go to: Supabase Dashboard → Database → Replication → Supabase Realtime
-- and toggle ON the `notifications` table, OR run:
alter publication supabase_realtime add table notifications;
