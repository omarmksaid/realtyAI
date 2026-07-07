-- Team invites, on-call SMS, and configurable business hours

alter table memberships add column email text;          -- display without auth.users joins
alter table memberships add column phone text;          -- E.164, for hot-lead SMS
alter table memberships add column on_call boolean not null default false;

create table invites (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  role text not null default 'agent' check (role in ('admin','agent')),
  token text not null unique,
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table invites enable row level security;
create policy tenant_select on invites for select using (company_id in (select my_company_ids()));
create policy tenant_insert on invites for insert with check (company_id in (select my_company_ids()));

-- Business hours live in companies.settings.business_hours:
-- { "mon": [["09:00","17:00"]], "tue": [["09:00","17:00"]], ... "sat": [], "sun": [],
--   "holidays": ["2026-07-01", "2026-08-03"] }
-- Staffed intervals = humans handle leads; everything else = realtyAI runs.
