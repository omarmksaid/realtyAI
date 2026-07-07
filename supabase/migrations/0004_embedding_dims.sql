-- Align vector dims with Voyage voyage-3.5 (1024). Run before any chunks exist,
-- or truncate doc_chunks first if re-running after a model switch.
drop function if exists match_chunks(uuid, vector, int);
drop index if exists doc_chunks_embedding;
alter table doc_chunks alter column embedding type vector(1024);
create index doc_chunks_embedding on doc_chunks using hnsw (embedding vector_cosine_ops);

create or replace function match_chunks(p_project uuid, p_embedding vector(1024), p_count int default 6)
returns table (content text, similarity float)
language sql stable as $$
  select content, 1 - (embedding <=> p_embedding) as similarity
  from doc_chunks
  where project_id = p_project
  order by embedding <=> p_embedding
  limit p_count
$$;
