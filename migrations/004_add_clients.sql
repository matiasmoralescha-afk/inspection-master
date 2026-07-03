-- Migration 004: clients table
CREATE TABLE IF NOT EXISTS clients (
  id           SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL,
  locations    TEXT,          -- JSON array e.g. '["Miami","Texas"]'
  known_modes  TEXT,          -- JSON array e.g. '["ocean","air"]'
  cutoff_hour  INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed data
INSERT INTO clients (display_name, slug, locations, known_modes, cutoff_hour) VALUES
  ('Alpine Fresh',    'alpine_fresh',    '["Miami","Texas","Los Angeles"]',          '["ocean","air"]',             17),
  ('Prime Time',      'prime_time',      '["Miami","Texas"]',                         '["ocean","air","terrestre"]', 16),
  ('Altar Produce',   'altar_produce',   '["Miami","Texas"]',                         '["ocean"]',                   16),
  ('Growers Are Us',  'growers_are_us',  '["Miami"]',                                 '["ocean","air"]',             NULL),
  ('GreenFruit',      'greenfruit',      '["Miami"]',                                 '["ocean"]',                   NULL),
  ('Fresh Way',       'fresh_way',       '["Miami","Texas","Los Angeles"]',           '["ocean","air","terrestre"]', NULL),
  ('Robinson Fresh',  'robinson_fresh',  '["Miami"]',                                 '["ocean","air"]',             NULL),
  ('Square One',      'square_one',      '["Miami","Texas"]',                         '["ocean","air","repack","rejection"]', NULL),
  ('AgroPeppers USA', 'agropeppers',     '["Miami"]',                                 '["ocean"]',                   NULL),
  ('Harvest',         'harvest',         '["Miami"]',                                 '["ocean"]',                   NULL),
  ('Baja Son',        'baja_son',        '["Miami"]',                                 '["ocean"]',                   NULL),
  ('Nativa',          'nativa',          '["Miami"]',                                 '["ocean","air"]',             NULL),
  ('ICON',            'icon',            '["Miami"]',                                 '["ocean","air"]',             NULL),
  ('Sol de Ica',      'sol_de_ica',      '["Miami"]',                                 '["ocean","air"]',             NULL),
  ('Sunkist',         'sunkist',         '["Oxnard","Los Angeles","Miami","New Jersey"]', '["ocean"]',               NULL),
  ('Twin River',      'twin_river',      '["Texas"]',                                 '["terrestre"]',               NULL)
ON CONFLICT (slug) DO NOTHING;
