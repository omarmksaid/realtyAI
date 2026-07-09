-- Callback requests extracted from AI conversations
create table callbacks (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  conversation_id uuid references conversations(id),
  requested_time timestamptz,  -- when the lead wants to be called back
  lead_name text,
  phone text,
  notes text,  -- context from the conversation
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  created_at timestamptz not null default now()
);
alter table callbacks enable row level security;
create policy tenant_select on callbacks for select to authenticated, public using (company_id in (select my_company_ids()));
create policy tenant_insert on callbacks for insert to authenticated, public with check (company_id in (select my_company_ids()));
create policy tenant_update on callbacks for update to authenticated, public using (company_id in (select my_company_ids()));
create index callbacks_company_time on callbacks (company_id, requested_time);
