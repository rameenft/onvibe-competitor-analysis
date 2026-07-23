# OnVibe Competitive Analysis — Project Summary & Handoff

## What this is

A web app that takes a business (name, industry, location, social handles) plus up to
three competitors, and produces two reports:

1. **A detailed report** — full methodology, all charts, and every metric behind the
   findings, split into three explicit sections: **what the data show**, **what we
   believe may explain it**, and **what we recommend testing**.
2. **A customer-facing report** (OnVibe-branded) — condensed to what a client actually
   needs: the 3 most important findings, content patterns that are working, competitive
   gaps, 3-5 experiments to run next, and a 30/60/90-day plan with success metrics.

Both are viewable in-browser and downloadable as PDFs.

## The workflow, end to end

1. **Intake form** — company name, industry, region, platform(s) to analyze, target
   handle(s), and exactly 3 competitors with their handles.
2. **Handle validation** — before anything expensive runs, every handle is checked
   against the real platform to confirm it resolves to an actual account. A typo'd or
   wrong handle fails immediately with a clear error, instead of wasting a full paid run.
3. **Scraping** (Apify) — profile data and the last 90 days of posts for every account.
4. **Content classification** (Claude) — every post is tagged into one category:
   collaboration, campaign, paid promotion, product, testimonial, educational, or other.
5. **Metrics** — engagement rate, percentile rank against the competitor set, weekly
   growth, media-type performance (reels vs. photos vs. carousel), and collaboration
   cadence vs. each account's own organic baseline. Includes a built-in "sense-making"
   guard: an account with a high engagement rate but a tiny audience or a handful of
   interactions gets flagged as low-sample, so a small account never reads as
   "outperforming" when it's really just a thin sample.
6. **Synthesis** (Claude) — turns the metrics into the data/explanation/recommendation
   writeup for the detailed report, plus a separate pass that produces the condensed
   customer-report structure.
7. **PDF rendering** (Playwright) — captures the live report pages and uploads both PDFs
   to storage.

Everything runs as a background worker process, not inside the web request — so a
multi-minute pipeline run doesn't time out or block the app.

## Current status: verified on Instagram, with real data

I ran this end-to-end against OnVibe's real Instagram account plus three real
competitors (Stanley/Stan, Predis.ai, Ocoya). Real scraping, real Claude classification,
real synthesis, real PDFs — all confirmed working, including edge cases like an account
with zero posts in the window and low-sample engagement warnings.

**Instagram is the only platform actually tested against live data.** TikTok and
LinkedIn support is built (the same pipeline, same UI, same reports), but the exact
field names each platform's scraper returns were never verified against a real run —
they're implemented against publicly documented actor schemas, not confirmed live
output. The code is explicit about this everywhere it matters
(`worker/platforms/tiktok.ts` and `worker/platforms/linkedin.ts` both have comments
flagging this). Before relying on TikTok or LinkedIn results, someone should run one
real analysis on each and check the numbers make sense — the same verification pass
Instagram already went through.

## One known data limitation (not a bug)

The report will show weekly follower growth as an honest "data gap" rather than made-up
numbers, for now. Reason: no free or paid service reliably has historical follower data
for an arbitrary, previously-untracked account — I checked both Social Blade and
HypeAuditor directly against real accounts, and neither had usable history for a
247K-follower competitor, let alone a small business account. The tool already saves a
snapshot of current followers every time it runs, so real growth becomes visible on its
own after the same accounts get analyzed a few weeks in a row. There's no fix that
doesn't involve either waiting for that accumulation or paying for a dedicated
historical-data API.

## Tech stack

- **Next.js (TypeScript)** — the web app (form, status page, both report pages)
- **A standalone worker process** — runs the actual pipeline in the background
- **Supabase (Postgres)** — all data: analyses, accounts, posts, computed metrics,
  generated reports
- **Apify** — scraping (Instagram/TikTok/LinkedIn actors + a Social Blade actor for
  growth history)
- **Claude (Anthropic API)** — content classification and report synthesis
- **Playwright** — renders the live report pages to PDF

## What it costs to run

- **Apify**: pay-as-you-go, free tier gives $5/month in credits
- **Anthropic (Claude API)**: pay-as-you-go, no ongoing free tier (one-time $5 trial
  credit for new accounts); a single analysis run costs well under $1 in Claude usage
- **Supabase**: free tier is enough for this scale

## Repo

[github.com/rameenft/onvibe-competitor-analysis](https://github.com/rameenft/onvibe-competitor-analysis)
(public). The original Python/Streamlit prototype is preserved under
`legacy-streamlit-prototype/` for reference; everything active is the Next.js app.
