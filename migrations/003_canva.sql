-- ============================================================
-- Per-user Canva OAuth connections (MCP auth via CIMD — no
-- Canva Developer Portal app, no client_secret to store).
-- Run with: psql $DATABASE_URL -f migrations/003_canva.sql
-- ============================================================

create table if not exists canva_connections (
  user_id       text primary key references users(id) on delete cascade,
  access_token  text not null,
  refresh_token text,
  expires_at    timestamptz not null,
  scope         text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_canva_connections_updated_at on canva_connections;
create trigger trg_canva_connections_updated_at before update on canva_connections
  for each row execute function set_updated_at();
