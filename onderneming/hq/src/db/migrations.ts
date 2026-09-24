/**
 * Databaseschema van HQ. Elke migratie draait precies één keer (bijgehouden in schema_migrations).
 * Voeg nieuwe migraties altijd onderaan toe; wijzig nooit een migratie die al gedraaid heeft.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "001_init",
    sql: `
create table branches (
  id integer generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  description text,
  template text,
  status text not null default 'active' check (status in ('active', 'paused', 'killed')),
  monthly_budget_eur numeric(12, 2) not null default 0 check (monthly_budget_eur >= 0),
  lead_agent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table experiments (
  id integer generated always as identity primary key,
  branch_id integer not null references branches(id),
  parent_id integer references experiments(id),
  iteration integer not null default 0,
  title text not null,
  hypothesis text not null,
  metric_name text not null,
  metric_target numeric not null check (metric_target > 0),
  budget_eur numeric(12, 2) not null check (budget_eur > 0),
  duration_days integer not null check (duration_days between 1 and 90),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'running', 'keep', 'iterate', 'killed', 'rejected')),
  prediction text,
  evidence_links text[] not null default '{}',
  plan text,
  proposed_by_agent_id text,
  lead_agent_id text,
  paperclip_project_id text unique,
  approval_id text,
  started_at timestamptz,
  deadline_at timestamptz,
  ended_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index experiments_status_idx on experiments(status);

create table metrics (
  id integer generated always as identity primary key,
  experiment_id integer not null references experiments(id),
  name text not null,
  value numeric not null,
  source text not null,
  trusted boolean not null,
  note text,
  external_id text,
  reported_by text not null,
  recorded_at timestamptz not null default now(),
  unique (source, external_id)
);
create index metrics_experiment_idx on metrics(experiment_id, name);

create table ledger (
  id integer generated always as identity primary key,
  branch_id integer references branches(id),
  experiment_id integer references experiments(id),
  kind text not null check (kind in ('token_cost', 'spend', 'revenue')),
  amount_eur numeric(12, 2) not null check (amount_eur >= 0),
  source text not null check (source <> 'agent'),
  external_id text not null,
  description text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (source, external_id)
);
create index ledger_occurred_idx on ledger(occurred_at);
create index ledger_branch_idx on ledger(branch_id, kind);

create table lessons (
  id integer generated always as identity primary key,
  branch_id integer references branches(id),
  experiment_id integer references experiments(id),
  lesson text not null,
  evidence text,
  tags text[] not null default '{}',
  created_by text not null,
  created_at timestamptz not null default now()
);
create index lessons_search_idx on lessons
  using gin (to_tsvector('simple', coalesce(lesson, '') || ' ' || coalesce(evidence, '')));

create table approvals (
  id integer generated always as identity primary key,
  paperclip_approval_id text not null unique,
  paperclip_type text not null,
  kind text not null,
  title text not null,
  summary text,
  amount_eur numeric(12, 2),
  experiment_id integer references experiments(id),
  branch_id integer references branches(id),
  requested_by_agent_id text,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'revision_requested', 'approved', 'rejected')),
  decision_note text,
  decided_at timestamptz,
  applied_at timestamptz,
  apply_error text,
  notified_at timestamptz,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approvals_status_idx on approvals(status);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table audit_log (
  id integer generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  details jsonb not null default '{}'
);
create index audit_log_actor_idx on audit_log(actor, action, at);

create table job_runs (
  name text primary key,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text,
  last_error text
);

create table notifications_sent (
  key text primary key,
  sent_at timestamptz not null default now()
);

insert into branches (slug, name, description, status, monthly_budget_eur)
values ('holding', 'Holding', 'Overhead: CEO, analist en alles wat niet bij een tak hoort.', 'active', 0);
`,
  },
  {
    id: "002_office",
    sql: `
-- Wat er in het kantoor gebeurt: agents die werken, praten, iets opzoeken of iets vragen.
create table office_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  type text not null,
  agent_id text,
  target_agent_id text,
  text text,
  data jsonb not null default '{}',
  -- Voorkomt dubbele gebeurtenissen als dezelfde Paperclip-activiteit twee keer langskomt.
  source_key text unique
);
create index office_events_at_idx on office_events(at);

-- Notities van agents: het gedeelde geheugen (ook als Markdown in de kennisbank-map).
create table notes (
  id integer generated always as identity primary key,
  agent_id text,
  author text not null,
  title text not null,
  body text not null,
  tags text[] not null default '{}',
  branch_id integer references branches(id),
  experiment_id integer references experiments(id),
  created_at timestamptz not null default now()
);
create index notes_fts_idx on notes using gin (to_tsvector('simple', title || ' ' || body));
`,
  },
  {
    id: "003_profiles",
    sql: `
-- Wat jij in het kantoor aan een agent verandert: een bijnaam en een uiterlijk.
-- Ook voor 'owner' (jij) en 'hq-bot' (de bot die je berichten stuurt).
create table agent_profiles (
  agent_id text primary key,
  nickname text,
  avatar integer check (avatar between 0 and 11),
  updated_at timestamptz not null default now()
);
`,
  },
  {
    id: "004_werkplaats",
    sql: `
-- De werkplaats: projecten die je (met Claude Code) bouwt, gevolgd via GitHub en een gezondheidscheck.
create table code_projects (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null,
  repo text,
  url text,
  health_url text,
  branch_slug text,
  backlog_path text not null default 'BACKLOG.md',
  description text,
  -- Wat HQ de vorige keer bij GitHub zag (branches, PR's, tests, uitrol, backlog).
  state jsonb not null default '{}',
  -- Uitkomst van de gezondheidscheck (bereikbaar, sinds wanneer, hoe snel).
  health jsonb not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Claude Code-sessies: gezien aan commits (Claude-Session in het bericht, of een claude/-branch) of via hooks.
create table code_sessions (
  id text primary key,
  project_key text references code_projects(key) on delete set null,
  source text not null check (source in ('cloud', 'local', 'action')),
  url text,
  branch text,
  title text,
  last_action text,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  commits integer not null default 0,
  pr jsonb
);
create index code_sessions_activity_idx on code_sessions(last_activity_at desc);

-- Elke gezondheidscheck, voor de uptime van de afgelopen dag (HQ ruimt na 14 dagen op).
create table code_health (
  project_key text not null references code_projects(key) on delete cascade,
  at timestamptz not null default now(),
  ok boolean not null,
  status integer,
  ms integer
);
create index code_health_idx on code_health(project_key, at desc);
`,
  },
  {
    id: "005_helpers",
    sql: `
-- Helpers (sub-agents) die een Claude Code-sessie inzet: iets uitzoeken, een plan maken, een review.
create table code_helpers (
  session_id text not null references code_sessions(id) on delete cascade,
  agent_id text not null,
  agent_type text not null,
  task text,
  last_action text,
  tools integer not null default 0,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (session_id, agent_id)
);
create index code_helpers_activity_idx on code_helpers(last_activity_at desc);
`,
  },
];
