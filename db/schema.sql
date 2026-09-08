-- RAVEN persistence schema.
-- Apply to any Postgres (self-hosted, Neon/Supabase free tier, or a local container).
-- Generated from lib/raven/db/schema.ts; edit that file, not this one.
-- The brain runs fine without it: this schema is only reached when DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS raven_conversations (
  id            text PRIMARY KEY,
  session_id    text NOT NULL,
  title         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raven_conversations_session_idx ON raven_conversations (session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS raven_messages (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES raven_conversations (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'raven', 'system')),
  content         text NOT NULL,
  mode            text,
  state           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raven_messages_conversation_idx ON raven_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS raven_memories (
  id         text PRIMARY KEY,
  session_id text NOT NULL,
  key        text NOT NULL,
  value      text NOT NULL,
  importance real NOT NULL DEFAULT 0.5,
  source     text NOT NULL DEFAULT 'extracted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raven_memories_session_key_unique UNIQUE (session_id, key)
);

CREATE INDEX IF NOT EXISTS raven_memories_session_idx ON raven_memories (session_id, importance DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS raven_agent_runs (
  id              text PRIMARY KEY,
  conversation_id text NOT NULL,
  goal            text NOT NULL,
  mode            text NOT NULL,
  status          text NOT NULL,
  steps           jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools_used      jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified        boolean NOT NULL DEFAULT false,
  result          text NOT NULL DEFAULT '',
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS raven_agent_runs_conversation_idx ON raven_agent_runs (conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS raven_tool_runs (
  id              text PRIMARY KEY,
  agent_run_id    text,
  conversation_id text,
  tool_name       text NOT NULL,
  input           jsonb,
  output          jsonb,
  status          text NOT NULL,
  error           text,
  ms              integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raven_tool_runs_run_idx ON raven_tool_runs (agent_run_id, created_at);
