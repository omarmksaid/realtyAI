-- Per-event operating cost tracking: every billable action records what it cost,
-- so quotes to customers come from real data, and each conversation shows its price.

create table cost_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  category text not null check (category in ('voice','whatsapp','email','sms','llm','embedding')),
  amount_usd numeric(10,6) not null,
  meta jsonb not null default '{}',        -- tokens, minutes, template vs session, actual-vs-estimated
  created_at timestamptz not null default now()
);
create index cost_events_company_month on cost_events (company_id, created_at desc);
create index cost_events_conversation on cost_events (conversation_id);

alter table cost_events enable row level security;
create policy tenant_select on cost_events for select using (company_id in (select my_company_ids()));
