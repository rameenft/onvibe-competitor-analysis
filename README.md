# OnVibe Competitive Analysis

## What this is

A web app that takes a business (name, industry, location, social handles) plus up to
three competitors, and produces two reports:

1. **A detailed report** — full methodology, all charts, and every metric behind the
   findings, split into three explicit sections: **what the data show**, **what we
   believe may explain it**, and **what we recommend testing**.
   [Detailed report (PDF)](https://ebqjomghuarqtbxkoevr.supabase.co/storage/v1/object/public/reports/a4be3358-acd4-42af-9a78-69dd415aafc5/detailed.pdf)
3. **A customer-facing report** (OnVibe-branded) — condensed to what a client actually
   needs: the 3 most important findings, content patterns that are working, competitive
   gaps, 3-5 experiments to run next, and a 30/60/90-day plan with success metrics.
   [Customer-facing report (PDF)](https://ebqjomghuarqtbxkoevr.supabase.co/storage/v1/object/public/reports/a4be3358-acd4-42af-9a78-69dd415aafc5/customer.pdf)

Both are viewable in-browser and downloadable as PDFs.


   **Live app**: [onvibe-competitor-analysis.vercel.app](https://onvibe-competitor-analysis.vercel.app/)
— free to run: the web app is hosted on Vercel's free tier, and the background pipeline
runs via a scheduled GitHub Actions workflow (`.github/workflows/worker.yml`), which is
free and unlimited on public repositories. A submitted analysis is picked up within
about 5 minutes (the workflow's schedule interval) and takes a few more minutes to
complete.


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


**Setup note**: this added a `views` column to the `posts` table — run
`alter table posts add column if not exists views integer;` in the Supabase SQL editor
before the next real analysis (scraping will fail without it).

## Tech stack

- **Next.js (TypeScript)** — the web app (form, status page, both report pages)
- **A standalone worker process** — runs the actual pipeline in the background
- **Supabase (Postgres)** — all data: analyses, accounts, posts, computed metrics,
  generated reports
- **Apify** — scraping (Instagram/TikTok/LinkedIn actors + a Social Blade actor for
  growth history)
- **Claude (Anthropic API)**, moving to **Gemini** — content classification and report
  synthesis
- **Playwright** — renders the live report pages to PDF


## Repo structure

```
app/                        Next.js app -- pages and API routes
  page.tsx                    Intake form (company/competitors/handles)
  analyses/[id]/page.tsx      Status page (polls pipeline progress)
  analyses/[id]/report/       The two report pages (detailed, customer)
  api/analyses/               Create-analysis and status-check endpoints
  api/validate-handles/       Pre-flight handle validation endpoint

worker/                     The background pipeline (a separate always-on process)
  index.ts                    Polls for new analyses and runs the pipeline
  platforms/                  One file per platform (instagram/tiktok/linkedin) plus
                               socialblade.ts for historical growth data -- each
                               implements the same fetchProfile/fetchPosts/
                               fetchHistoricalSnapshots interface
  pipeline/                   scrape -> classify -> metrics -> synthesize -> render,
                               one file per pipeline stage

lib/                        Shared code used by both app/ and worker/
  config.ts                    Environment variable loading
  supabase.ts, apify.ts,
  anthropic.ts                 API client setup for each service
  types.ts                     Shared TypeScript types (database rows, metrics shapes)

components/
  charts/                      The four chart components (Recharts)
  reports/                     Report-page building blocks, including OnVibe's brand
                               colors (brand.ts) and the PDF-capture readiness marker

supabase/schema.sql          The full database schema

legacy-streamlit-prototype/  The original Python/Streamlit prototype (kept for
                             reference, not part of the running app)
```

## Repo

[github.com/rameenft/onvibe-competitor-analysis](https://github.com/rameenft/onvibe-competitor-analysis)
(public).
