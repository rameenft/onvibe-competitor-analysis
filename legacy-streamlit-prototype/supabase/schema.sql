-- One analysis = one target company + up to 5 competitors, scoped to a single run.
create table if not exists analyses (
    id uuid primary key default gen_random_uuid(),
    company_name text not null,
    industry text not null,
    region text not null,
    created_at timestamptz not null default now(),
    status text not null default 'pending' -- pending | scraping | categorizing | analyzing | rendering | done | failed
);

-- Target + competitor Instagram accounts for a given analysis.
create table if not exists accounts (
    id uuid primary key default gen_random_uuid(),
    analysis_id uuid not null references analyses(id) on delete cascade,
    handle text not null,
    role text not null check (role in ('target', 'competitor')),
    followers integer,
    following integer,
    bio text,
    scraped_at timestamptz,
    unique (analysis_id, handle)
);

-- Posts from the last 30 days for each account.
create table if not exists posts (
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references accounts(id) on delete cascade,
    post_url text not null,
    caption text,
    media_type text, -- image | video | reel | carousel
    likes integer not null default 0,
    comments integer not null default 0,
    posted_at timestamptz not null,
    coauthor_handle text, -- Instagram native collaborator tag, if present
    scraped_at timestamptz not null default now(),
    unique (account_id, post_url)
);

-- LLM-assigned content category per post.
create table if not exists post_categories (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references posts(id) on delete cascade,
    category text not null, -- collaboration | campaign | paid_promotion | product | testimonial | educational | other
    confidence numeric,
    rationale text,
    unique (post_id)
);

-- Final computed output for an analysis: metrics blob, chart paths, PDF path.
create table if not exists analysis_reports (
    id uuid primary key default gen_random_uuid(),
    analysis_id uuid not null references analyses(id) on delete cascade,
    metrics jsonb not null,
    swot jsonb not null,
    recommendations jsonb not null,
    pdf_path text,
    created_at timestamptz not null default now()
);

create index if not exists idx_accounts_analysis on accounts(analysis_id);
create index if not exists idx_posts_account on posts(account_id);
create index if not exists idx_posts_posted_at on posts(posted_at);
