-- Knowledge graph built by ml/onvibe_ml/kg from posts + LLM entity extraction.
-- Run once in the Supabase SQL editor; `python -m onvibe_ml kg build --persist` fills it.
-- Node ids are deterministic ("type:key", e.g. "topic:file transfer", "account:instagram:nasa"),
-- so a rebuild replaces rows in place rather than duplicating them.

create table if not exists kg_nodes (
    id text primary key,
    type text not null check (type in (
        'company', 'account', 'post', 'category', 'hashtag', 'topic',
        'product', 'organization', 'person', 'campaign'
    )),
    name text not null,
    properties jsonb not null default '{}'::jsonb,
    first_seen timestamptz, -- earliest post that connects to this node
    last_seen timestamptz,
    built_at timestamptz not null default now()
);

create table if not exists kg_edges (
    id text primary key, -- hash of (src, key, dst)
    src text not null references kg_nodes(id) on delete cascade,
    dst text not null references kg_nodes(id) on delete cascade,
    type text not null check (type in (
        'OPERATES', 'COMPETES_WITH', 'POSTED', 'IN_CATEGORY', 'TAGGED', 'MENTIONS',
        'COLLABORATED_WITH', 'ABOUT', 'PART_OF', 'MADE_BY'
    )),
    analysis_id uuid references analyses(id) on delete set null, -- set on COMPETES_WITH
    observed_at timestamptz, -- when the evidence (post / analysis) is from
    properties jsonb not null default '{}'::jsonb
);

-- Every entity-resolution decision, so a merge can be audited or reversed.
create table if not exists kg_aliases (
    alias text not null,
    node_id text not null references kg_nodes(id) on delete cascade,
    method text not null, -- normalize | fuzzy | account-match
    primary key (alias, node_id)
);

create index if not exists idx_kg_nodes_type on kg_nodes(type);
create index if not exists idx_kg_edges_src on kg_edges(src, type);
create index if not exists idx_kg_edges_dst on kg_edges(dst, type);
create index if not exists idx_kg_edges_observed on kg_edges(observed_at);
