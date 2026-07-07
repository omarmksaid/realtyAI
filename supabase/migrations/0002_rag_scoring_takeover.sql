-- RAG knowledge base, lead scoring, and human takeover support

create extension if not exists vector;

-- Knowledge sources per project (Drive folder, pasted text, uploaded file)
create table documents (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  source text not null check (source in ('drive','text','upload')),
  name text not null,
  drive_file_id text,                       -- when source = drive
  storage_path text,                        -- Supabase Storage path when source = upload
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  created_at timestamptz not null default now()
);

create table doc_chunks (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  content text not null,
  embedding vector(1536),                   -- match your embedding model dims
  created_at timestamptz not null default now()
);
create index doc_chunks_embedding on doc_chunks using hnsw (embedding vector_cosine_ops);
create index doc_chunks_project on doc_chunks (project_id);

-- Drive sync config lives on the project
alter table projects add column drive_folder_url text;
alter table projects add column drive_last_synced timestamptz;

-- Lead scoring (computed after each conversation turn + in the nightly digest)
alter table leads add column score text check (score in ('hot','warm','cold'));
alter table leads add column score_reason text;
alter table leads add column detected_language text;   -- BCP-47, e.g. 'fa', 'zh', 'pa'

-- Takeover: conversations already have status='handed_off' and handed_off_to.
-- Unique constraint so inbound webhook upserts hit one conversation per lead+channel.
create unique index conversations_lead_channel on conversations (lead_id, channel);

-- RLS for new tables
alter table documents enable row level security;
alter table doc_chunks enable row level security;
create policy tenant_select on documents for select using (company_id in (select my_company_ids()));
create policy tenant_insert on documents for insert with check (company_id in (select my_company_ids()));
create policy tenant_update on documents for update using (company_id in (select my_company_ids()));
create policy tenant_select on doc_chunks for select using (company_id in (select my_company_ids()));

-- Retrieval helper used by the conversation service
create or replace function match_chunks(p_project uuid, p_embedding vector(1536), p_count int default 6)
returns table (content text, similarity float)
language sql stable as $$
  select content, 1 - (embedding <=> p_embedding) as similarity
  from doc_chunks
  where project_id = p_project
  order by embedding <=> p_embedding
  limit p_count
$$;
