-- Internal data-assistant chat ("ask questions about your leads")

create table assistant_threads (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,                              -- first question, truncated
  created_at timestamptz not null default now()
);

create table assistant_messages (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  thread_id uuid not null references assistant_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  tool_activity jsonb not null default '[]',  -- which tools ran, with what args (auditable)
  created_at timestamptz not null default now()
);
create index assistant_messages_thread on assistant_messages (thread_id, created_at);

alter table assistant_threads enable row level security;
alter table assistant_messages enable row level security;
create policy tenant_select on assistant_threads for select using (company_id in (select my_company_ids()));
create policy tenant_insert on assistant_threads for insert with check (company_id in (select my_company_ids()));
create policy tenant_select on assistant_messages for select using (company_id in (select my_company_ids()));
create policy tenant_insert on assistant_messages for insert with check (company_id in (select my_company_ids()));

-- Voice config needs no schema change: lives in companies.settings, e.g.
-- settings: { "voice": { "provider": "11labs", "voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah" },
--             "whatsapp_number": "+1416...", "first_touch_template_sid": "HX..." }
