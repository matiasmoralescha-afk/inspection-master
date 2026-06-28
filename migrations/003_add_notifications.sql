-- Migration 003: Add notifications table
-- Run in: https://supabase.com/dashboard/project/vrqkjzcmpnltkggbxonp/sql

create table if not exists notifications (
    id          bigint generated always as identity primary key,
    shipment_id bigint references shipments(id),
    event_type  text not null,
    sent_at     timestamptz not null default now(),
    channels    text,
    message     text
);

-- Deduplication is enforced at the Python level (agent/notifications.py → _already_notified())
-- A DB-level unique index on a functional expression (sent_at::date) is not supported on Supabase
-- free tier due to the IMMUTABLE requirement on timestamptz → date casts.

alter table notifications disable row level security;

-- Enable Supabase Realtime on this table (required for dashboard push toasts)
alter publication supabase_realtime add table notifications;
