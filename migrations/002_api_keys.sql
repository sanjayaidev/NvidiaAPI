-- ============================================================
-- API keys for external/public access (separate from your
-- personal chat.js, which keeps using lib/auth.js's fixed id).
-- Run with: psql $DATABASE_URL -f migrations/002_api_keys.sql
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists api_keys (
  id                uuid primary key default uuid_generate_v4(),
  owner_label       text not null,              -- human-readable label, e.g. client's name/email — NOT used for auth
  key_hash          text not null unique,        -- sha256 hex of the raw key; raw key is shown once at creation, never stored
  key_prefix        text not null,               -- first 8 chars of raw key, shown in UI lists so owner can recognize which key is which
  tier              text not null,               -- 'managed' | 'byok'
  allowed_models    jsonb not null default '[]', -- [] means "all models in lib/registry.js allowed"; otherwise explicit allowlist
  byok_nvidia_key_enc  text,                     -- AES-GCM encrypted NVIDIA key, only set when tier = 'byok'
  byok_nvidia_key_iv   text,                     -- base64 IV for the above, required to decrypt
  daily_request_cap  integer not null default 200, -- only enforced for tier = 'managed'
  rpm_override       integer,                    -- null = use lib/ratelimit.js DEFAULT_RPM
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  last_used_at       timestamptz
);

create index if not exists idx_api_keys_hash on api_keys(key_hash);

-- ---------- per-key daily usage counter ----------
-- Reset is implicit: we key by (api_key_id, day) and only ever read/write
-- today's row, so nothing needs a cron to "reset" — yesterday's row is
-- just never queried again. Cheap to prune later if the table grows.
create table if not exists api_key_daily_usage (
  api_key_id   uuid not null references api_keys(id) on delete cascade,
  day          date not null default current_date,
  request_count integer not null default 0,
  primary key (api_key_id, day)
);
