-- Sources mapping page support
alter table leads add column form_id text;                 -- which ad form produced this lead
create index leads_form on leads (company_id, form_id, created_at desc);
-- Google form verification timestamps live in lead_sources.config:
--   { "google_key": "...", "form_project_map": {...}, "test_received_at": "..." }
