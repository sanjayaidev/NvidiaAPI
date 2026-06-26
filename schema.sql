-- ============================================================
-- SMAgents schema — Neon Postgres
-- Run with: psql $DATABASE_URL -f schema.sql
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm; -- enables fast ILIKE / search on message content

-- ---------- users ----------
-- Stubbed for now: auth.js will eventually populate this from
-- whatever provider you pick (Clerk, Auth.js, etc). For now,
-- anything calling our API just needs a userId string — see
-- lib/auth.js getUserId() which fakes this.
create table if not exists users (
  id            text primary key,        -- external auth id (Clerk user id, etc) or 'demo-user' for now
  email         text,
  plan          text not null default 'free', -- free | pro | business — drives rate limits & quotas
  ip_at_signup  text,                    -- IP address at signup time for fraud prevention
  trial_expires_at timestamptz,          -- when the free trial expires (NULL for non-trial accounts)
  created_at    timestamptz not null default now()
);

-- ---------- threads ----------
-- One thread = one conversation with ONE model, in ONE tool/modality.
-- This is what gives you "separate conversation window per model"
-- with full history, like browser tabs.
create table if not exists threads (
  id            uuid primary key default uuid_generate_v4(),
  user_id       text not null references users(id) on delete cascade,
  tool          text not null,            -- 'chat' | 'image' | 'video' | 'audio' | 'agent'
  model         text not null,            -- e.g. 'meta/llama-3.3-70b-instruct' or 'black-forest-labs/flux-1.1-pro'
  title         text not null default 'New conversation',
  pinned        boolean not null default false,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_threads_user_tool on threads(user_id, tool, updated_at desc);
create index if not exists idx_threads_user_model on threads(user_id, model);

-- ---------- messages ----------
-- Every chat turn, including generation requests/results for
-- image/video/audio tools (the "message" for an image tool is
-- the prompt; the assistant "message" carries the resulting
-- attachment instead of long text).
create table if not exists messages (
  id            uuid primary key default uuid_generate_v4(),
  thread_id     uuid not null references threads(id) on delete cascade,
  role          text not null,            -- 'user' | 'assistant' | 'system'
  content       text,                     -- text content (prompt or text reply)
  attachments   jsonb not null default '[]', -- [{type:'image', url:'https://r2...', meta:{...}}]
  job_id        uuid,                     -- set if this message is tied to an async job (see jobs table)
  created_at    timestamptz not null default now()
);

create index if not exists idx_messages_thread on messages(thread_id, created_at asc);
-- full text search across a user's message content (works alongside pg_trgm)
create index if not exists idx_messages_content_trgm on messages using gin (content gin_trgm_ops);

-- ---------- jobs ----------
-- The single async-job table for every provider: Replicate,
-- Transloadit, NIM Cosmos video, ElevenLabs TTS, browser-agent
-- runs, code-execution runs. Client polls GET /api/jobs/:id.
create table if not exists jobs (
  id            uuid primary key default uuid_generate_v4(),
  user_id       text not null references users(id) on delete cascade,
  thread_id     uuid references threads(id) on delete set null,
  tool          text not null,            -- 'image' | 'video' | 'audio' | 'agent' | 'transload'
  provider      text not null,            -- 'replicate' | 'transloadit' | 'nim-cosmos' | 'elevenlabs' | 'cf-browser' | 'cf-worker-exec'
  status        text not null default 'queued', -- queued | running | done | failed
  input         jsonb not null default '{}',
  output        jsonb not null default '{}',     -- e.g. {result_url, duration_ms, raw_provider_response}
  error         text,
  external_ref  text,                     -- provider's job/prediction id, for status lookups or webhook matching
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_jobs_user on jobs(user_id, created_at desc);
create index if not exists idx_jobs_external_ref on jobs(external_ref);
create index if not exists idx_jobs_status on jobs(status) where status in ('queued','running');

-- ---------- usage_events ----------
-- Append-only ledger for billing/quota enforcement. One row per
-- billable action. Cheap to write, aggregate with SQL when you
-- need "tokens used this month" or "images generated this month".
create table if not exists usage_events (
  id            bigserial primary key,
  user_id       text not null references users(id) on delete cascade,
  tool          text not null,
  model         text,
  provider      text,
  units         numeric not null default 1,   -- tokens, seconds, image count — meaning depends on tool
  unit_type     text not null default 'count', -- 'tokens' | 'seconds' | 'count'
  cost_usd      numeric(10,4),                  -- your cost from the provider, for margin tracking
  created_at    timestamptz not null default now()
);

create index if not exists idx_usage_user_time on usage_events(user_id, created_at desc);

-- ---------- updated_at trigger for threads & jobs ----------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_threads_updated_at on threads;
create trigger trg_threads_updated_at before update on threads
  for each row execute function set_updated_at();

drop trigger if exists trg_jobs_updated_at on jobs;
create trigger trg_jobs_updated_at before update on jobs
  for each row execute function set_updated_at();
