-- AfterHours: multi-tenant lead response platform
-- All tables carry company_id; RLS enforces tenant isolation via memberships.

create extension if not exists "uuid-ossp";

-- ============ TENANCY ============
create table companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  timezone text not null default 'America/Toronto',
  settings jsonb not null default '{}',   -- feature flags, branding, digest hour, etc.
  created_at timestamptz not null default now()
);

-- Supabase Auth owns auth.users; memberships map users -> companies with a role.
create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  role text not null default 'agent' check (role in ('owner','admin','agent')),
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- ============ PROJECTS & PROMPTS ============
create table projects (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,                      -- e.g. "The Riv Condos – Vaughan"
  city text,
  status text not null default 'active' check (status in ('active','paused','archived')),
  knowledge jsonb not null default '{}',   -- pricing ranges, deposit structure, occupancy, amenities, FAQs
  created_at timestamptz not null default now()
);

-- Versioned, per-project, per-channel prompts. Editing creates a new version; one active at a time.
create table prompt_templates (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,  -- null = company default
  channel text not null check (channel in ('whatsapp','voice','email','any')),
  name text not null,
  content text not null,                   -- system prompt body; supports {{lead_name}}, {{project_name}}, {{knowledge}}
  version int not null default 1,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ============ INGESTION ============
create table lead_sources (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text not null check (provider in ('meta','google','manual')),
  label text not null,
  config jsonb not null default '{}',      -- page_id, form_id -> project_id mapping, webhook key
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid references projects(id),
  source_id uuid references lead_sources(id),
  provider text not null,
  external_id text,                        -- meta leadgen_id / google lead_id (dedupe key)
  full_name text,
  phone text,                              -- E.164
  email text,
  campaign_id text,
  ad_id text,
  form_data jsonb not null default '{}',
  consent_ts timestamptz not null default now(),  -- CASL: when they submitted the form
  opted_out boolean not null default false,
  status text not null default 'new' check (status in ('new','contacted','engaged','qualified','handed_off','unresponsive','opted_out')),
  received_after_hours boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, provider, external_id)
);
create index leads_company_created on leads (company_id, created_at desc);
create index leads_phone on leads (company_id, phone);

-- ============ ROUTING RULES (configurable comms-by-time) ============
-- Evaluated in priority order; first match wins. Times are local to company timezone.
create table routing_rules (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null,                     -- "Weekday evening", "Late night", "Weekend"
  day_type text not null check (day_type in ('weekday','weekend','any')),
  start_time time not null,                -- e.g. 17:00
  end_time time not null,                  -- e.g. 22:00 (may wrap past midnight)
  channels text[] not null,                -- ordered, e.g. {whatsapp,voice,email}
  followup_delay_min int not null default 10, -- escalate to next channel if no reply
  priority int not null default 100,
  is_active boolean not null default true
);

-- ============ CONVERSATIONS & MESSAGES ============
create table conversations (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','voice','email')),
  status text not null default 'active' check (status in ('active','ended','handed_off')),
  handed_off_to uuid references auth.users(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table messages (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('outbound','inbound','internal')),
  role text not null check (role in ('ai','lead','human_agent','system')),
  content text not null,
  provider_message_id text,
  meta jsonb not null default '{}',        -- delivery status, call segment timings, etc.
  created_at timestamptz not null default now()
);
create index messages_convo on messages (conversation_id, created_at);

-- Voice calls get a row here; full transcript lives in messages (role ai/lead per turn).
create table calls (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  provider_call_id text,
  recording_url text,
  duration_sec int,
  outcome text,                            -- answered / voicemail / no_answer
  created_at timestamptz not null default now()
);

-- ============ DIGESTS & AUDIT ============
create table daily_summaries (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  for_date date not null,
  content text not null,                   -- AI-written synopsis
  stats jsonb not null default '{}',       -- counts by channel, project, outcome
  created_at timestamptz not null default now(),
  unique (company_id, for_date)
);

create table audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,                    -- 'prompt.updated', 'rule.created', 'lead.handed_off'...
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============ RLS ============
alter table companies enable row level security;
alter table memberships enable row level security;
alter table projects enable row level security;
alter table prompt_templates enable row level security;
alter table lead_sources enable row level security;
alter table leads enable row level security;
alter table routing_rules enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table calls enable row level security;
alter table daily_summaries enable row level security;
alter table audit_log enable row level security;

create or replace function my_company_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select company_id from memberships where user_id = auth.uid()
$$;

create policy member_read on companies for select using (id in (select my_company_ids()));
create policy member_rw_memberships on memberships for select using (company_id in (select my_company_ids()));

-- Generic per-table tenant policies
do $$
declare t text;
begin
  foreach t in array array['projects','prompt_templates','lead_sources','leads','routing_rules','conversations','messages','calls','daily_summaries','audit_log']
  loop
    execute format('create policy tenant_select on %I for select using (company_id in (select my_company_ids()));', t);
    execute format('create policy tenant_insert on %I for insert with check (company_id in (select my_company_ids()));', t);
    execute format('create policy tenant_update on %I for update using (company_id in (select my_company_ids()));', t);
  end loop;
end $$;

-- Backend workers use the service-role key and bypass RLS.

-- ============ SEED: your stated schedule ============
-- Weekday 17:00-22:00: WhatsApp -> call -> email
-- Weekday 22:00-09:00 (wraps midnight): WhatsApp + email only, no calls
-- Weekend all day: WhatsApp -> call -> email (daytime), quiet overnight
-- insert into routing_rules (company_id,label,day_type,start_time,end_time,channels,followup_delay_min,priority) values
--  (:cid,'Weekday evening','weekday','17:00','22:00','{whatsapp,voice,email}',10,10),
--  (:cid,'Late night','any','22:00','09:00','{whatsapp,email}',0,20),
--  (:cid,'Weekend day','weekend','09:00','22:00','{whatsapp,voice,email}',10,30);
