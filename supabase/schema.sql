-- One analysis = one target account + up to 3 competitors, across one or more platforms.
create table if not exists analyses (
    id uuid primary key default gen_random_uuid(),
    company_name text not null,
    industry text not null,
    region text not null,
    platforms text[] not null, -- subset of {instagram, tiktok, linkedin}
    window_days integer not null default 90,
    status text not null default 'pending'
        check (status in ('pending', 'scraping', 'categorizing', 'computing', 'synthesizing', 'rendering', 'done', 'failed')),
    status_detail text, -- granular progress message shown in the UI
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

-- Target + competitor accounts, one row per (analysis, platform, handle).
create table if not exists accounts (
    id uuid primary key default gen_random_uuid(),
    analysis_id uuid not null references analyses(id) on delete cascade,
    platform text not null check (platform in ('instagram', 'tiktok', 'linkedin')),
    handle text not null,
    role text not null check (role in ('target', 'competitor')),
    display_name text,
    followers integer, -- most recent known follower count
    following integer,
    bio text,
    scraped_at timestamptz,
    unique (analysis_id, platform, handle)
);

-- Weekly follower snapshots going back up to window_days, sourced from a
-- Social Blade scraper actor (historical) or the profile scraper itself
-- (current week, as a fallback). This is what makes real growth measurement
-- possible instead of a single point-in-time count.
create table if not exists account_snapshots (
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references accounts(id) on delete cascade,
    week_start date not null,
    followers integer not null,
    source text not null check (source in ('socialblade', 'apify_profile')),
    unique (account_id, week_start)
);

-- Posts from the last window_days for each account, media_type generalized
-- across platforms (reel/carousel are Instagram-specific, article/document
-- are LinkedIn-specific, etc).
create table if not exists posts (
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references accounts(id) on delete cascade,
    platform text not null check (platform in ('instagram', 'tiktok', 'linkedin')),
    post_url text not null,
    caption text,
    media_type text, -- image | video | reel | carousel | article | document | text
    likes integer not null default 0,
    comments integer not null default 0,
    shares integer, -- nullable: not all platforms/actors expose this
    posted_at timestamptz not null,
    coauthor_handle text, -- native collaborator/co-author tag, if present
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

-- LLM-synthesized narrative, split into the three explicit buckets the
-- report structure is built around: what the data show (data_observations),
-- what we believe may explain it (explanations), and what we recommend
-- testing (recommendations). One row per platform, plus a 'all' rollup row
-- for the cross-platform view.
create table if not exists analysis_insights (
    id uuid primary key default gen_random_uuid(),
    analysis_id uuid not null references analyses(id) on delete cascade,
    platform text not null check (platform in ('instagram', 'tiktok', 'linkedin', 'all')),
    metrics jsonb not null,
    data_observations jsonb not null,
    explanations jsonb not null,
    recommendations jsonb not null,
    created_at timestamptz not null default now(),
    unique (analysis_id, platform)
);

-- Final rendered output: one row per (analysis, report_type). pdf_url points
-- at a Supabase Storage object, not a local filesystem path.
create table if not exists analysis_reports (
    id uuid primary key default gen_random_uuid(),
    analysis_id uuid not null references analyses(id) on delete cascade,
    report_type text not null check (report_type in ('detailed', 'customer')),
    pdf_url text,
    content jsonb,
    created_at timestamptz not null default now(),
    unique (analysis_id, report_type)
);

create index if not exists idx_accounts_analysis on accounts(analysis_id);
create index if not exists idx_snapshots_account on account_snapshots(account_id, week_start);
create index if not exists idx_posts_account on posts(account_id);
create index if not exists idx_posts_posted_at on posts(posted_at);
create index if not exists idx_insights_analysis on analysis_insights(analysis_id);
create index if not exists idx_reports_analysis on analysis_reports(analysis_id);
