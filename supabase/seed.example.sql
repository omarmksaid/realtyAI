-- seed.example.sql — run AFTER migrations 0001..0007, once per new company.
-- Replace :COMPANY_ID after creating the company via signup (or insert one here).

-- 0. One-time per project (not per company): the uploads bucket for knowledge files.
insert into storage.buckets (id, name, public) values ('knowledge', 'knowledge', false)
on conflict (id) do nothing;

-- 1. (Optional) create a company + owner membership by hand for a pilot:
-- insert into companies (id, name, timezone) values
--   ('00000000-0000-0000-0000-000000000001', 'Northgate Realty', 'America/Toronto');
-- insert into memberships (user_id, company_id, role, email) values
--   ('<auth.users id from Supabase Auth>', '00000000-0000-0000-0000-000000000001', 'owner', 'owner@northgate.ca');

-- 2. After-hours routing defaults (the questionnaire answers may adjust these):
insert into routing_rules (company_id, label, day_type, start_time, end_time, channels, followup_delay_min, priority) values
  (:'COMPANY_ID', 'Weekday evening', 'weekday', '17:00', '21:00', '{whatsapp,voice,email}', 15, 10),
  (:'COMPANY_ID', 'Late night',      'any',     '21:00', '09:00', '{whatsapp,email}',        0, 20),
  (:'COMPANY_ID', 'Weekend day',     'weekend', '09:00', '21:00', '{whatsapp,voice,email}', 15, 30);

-- 3. Company-default conversation prompt (project-specific ones are created in Playbooks):
insert into prompt_templates (company_id, project_id, channel, name, content) values
  (:'COMPANY_ID', null, 'any', 'Company default', 
   'You represent the brokerage. Tone: warm, unhurried, never salesy. Answer questions using PROJECT KNOWLEDGE only. Always offer to book a morning call with the team and collect their preferred time. Reply in the lead''s language.');

-- 4. Business hours (or paint them in the Coverage calendar instead):
update companies set settings = settings || 
  '{"business_hours": {"mon": [["09:00","17:00"]], "tue": [["09:00","17:00"]], "wed": [["09:00","17:00"]], "thu": [["09:00","17:00"]], "fri": [["09:00","17:00"]], "sat": [], "sun": [], "holidays": []}}'::jsonb
where id = :'COMPANY_ID';
