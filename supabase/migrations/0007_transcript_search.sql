-- Full-text search across every conversation turn (WhatsApp, call transcripts, email).
-- 'simple' config, not 'english': no stemming, but it works across Farsi, Mandarin,
-- Punjabi, and English alike — the right trade for a multilingual lead base.

alter table messages add column search tsvector
  generated always as (to_tsvector('simple', content)) stored;
create index messages_search on messages using gin (search);

create or replace function search_transcripts(p_company uuid, p_query text, p_limit int default 20)
returns table (
  message_id uuid, conversation_id uuid, lead_id uuid, lead_name text,
  project_name text, channel text, role text, snippet text, at timestamptz
) language sql stable as $$
  select m.id, m.conversation_id, l.id, l.full_name, p.name, c.channel, m.role,
         ts_headline('simple', m.content, websearch_to_tsquery('simple', p_query),
                     'StartSel=<<, StopSel=>>, MaxWords=24, MinWords=12') as snippet,
         m.created_at
  from messages m
  join conversations c on c.id = m.conversation_id
  join leads l on l.id = c.lead_id
  left join projects p on p.id = l.project_id
  where m.company_id = p_company
    and m.search @@ websearch_to_tsquery('simple', p_query)
    and m.direction != 'internal'
  order by m.created_at desc
  limit p_limit
$$;
