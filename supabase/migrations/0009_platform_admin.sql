-- Platform admin (operator) layer: who runs realtyAI itself, and billing per company.

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- No RLS select policy on purpose: only the service-role backend reads it,
-- gated by the requirePlatformAdmin middleware. Add yourself:
--   insert into platform_admins (user_id) values ('<your auth.users id>');

alter table platform_admins enable row level security;

-- Billing lives on the company row. Stripe wiring comes later; these fields are
-- the management layer (what plan, what price, what status) that Stripe will sync to.
alter table companies add column plan text not null default 'trial'
  check (plan in ('trial','pilot','standard','custom'));
alter table companies add column plan_price_usd numeric(10,2) not null default 0;
alter table companies add column billing_status text not null default 'trial'
  check (billing_status in ('trial','active','past_due','cancelled'));
alter table companies add column trial_ends_at timestamptz;
alter table companies add column stripe_customer_id text;
alter table companies add column billing_notes text;
