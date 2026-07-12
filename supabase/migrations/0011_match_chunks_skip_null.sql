-- Ingest now stores chunk text first and embeds after, so an embedding outage or rate
-- limit leaves rows with content but embedding IS NULL (voice reads the text and never
-- touches the vector, so the document is still usable). Those rows must not participate
-- in the similarity search: a null vector in the distance sort can displace real matches.
--
-- Function replace only — no table change, no data touched.
create or replace function match_chunks(p_project uuid, p_embedding vector(1024), p_count int default 6)
returns table (content text, similarity float)
language sql stable as $$
  select content, 1 - (embedding <=> p_embedding) as similarity
  from doc_chunks
  where project_id = p_project
    and embedding is not null
  order by embedding <=> p_embedding
  limit p_count
$$;
