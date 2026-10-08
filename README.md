# OnVibe Competitive Analysis

## What this is

A web app that takes a business (name, industry, location, social handles) plus up to
three competitors, and produces two reports:

1. **A detailed report** — full methodology, all charts, and every metric behind the
   findings, split into three explicit sections: **what the data show**, **what we
   believe may explain it**, and **what we recommend testing**.
   [Detailed report (PDF)](https://ebqjomghuarqtbxkoevr.supabase.co/storage/v1/object/public/reports/a4be3358-acd4-42af-9a78-69dd415aafc5/detailed.pdf)
2. **A customer-facing report** (OnVibe-branded) — condensed to what a client actually
   needs: the 3 most important findings, content patterns that are working, competitive
   gaps, 3-5 experiments to run next, and a 30/60/90-day plan with success metrics.
   [Customer-facing report (PDF)](https://ebqjomghuarqtbxkoevr.supabase.co/storage/v1/object/public/reports/a4be3358-acd4-42af-9a78-69dd415aafc5/customer.pdf)

Both are viewable in-browser and downloadable as PDFs.


Runs locally (see [Running it](#running-it)).

## The workflow, end to end

1. **Intake form** — company name, industry, region, platform(s) to analyze, target
   handle(s), and exactly 3 competitors with their handles.
2. **Handle validation** — before anything expensive runs, every handle is checked
   against the real platform to confirm it resolves to an actual account. A typo'd or
   wrong handle fails immediately with a clear error, instead of wasting a full paid run.
3. **Scraping** (Apify) — profile data and the last 90 days of posts for every account.
4. **Content classification** (Gemini) — every post is tagged into one category:
   collaboration, campaign, paid promotion, product, testimonial, educational, or other.
   The prompt (`prompts/classify.json`) defines each category and gives ordered
   tie-break rules for posts that fit more than one.
5. **Metrics** — engagement rate, percentile rank against the competitor set, weekly
   growth, media-type performance (reels vs. photos vs. carousel), and collaboration
   cadence vs. each account's own organic baseline. Includes a built-in "sense-making"
   guard: an account with a high engagement rate but a tiny audience or a handful of
   interactions gets flagged as low-sample, so a small account never reads as
   "outperforming" when it's really just a thin sample.
6. **Synthesis** (Gemini) — turns the metrics into the data/explanation/recommendation
   writeup for the detailed report, plus a separate pass that produces the condensed
   customer-report structure.
7. **PDF rendering** (Playwright) — captures the live report pages and uploads both PDFs
   to storage.

Everything runs as a background worker process, not inside the web request — so a
multi-minute pipeline run doesn't time out or block the app.


## Running it

Copy `.env.example` to `.env.local` and fill in the Supabase, Apify and Gemini keys, then run the
SQL in `supabase/schema.sql` (and `supabase/kg_schema.sql` for the graph) in the Supabase SQL editor.
Three terminals, from the repo root:

```bash
npm install && npx playwright install chromium
npm run dev       # the web app on http://localhost:3000
npm run worker    # the pipeline; picks up analyses submitted in the app
```

The worker renders the PDFs by opening the report pages, so `npm run dev` has to be running while an
analysis finishes. Checks: `npm run typecheck`, `npm run lint`, `npm test` (TypeScript) and
`python -m pytest` in `ml/` (Python).

## Evals and knowledge graph (`ml/`, Python, runs on Gemini)

A Python layer on top of the pipeline. It reads the same Supabase tables the worker writes, runs on
Gemini (`gemini-3.8-flash`), and adds two things the pipeline didn't have:

- **Grounding check**: every number in the generated insights is traced back to the metrics the
  model was given. On real runs, 78 of 78 numeric claims were grounded and none were made up, and
  the checker itself catches 95% of deliberately injected fake numbers.
- **Classifier checks**: the post-classification prompt now lives in one shared file
  (`prompts/classify.json`), read by both the TypeScript worker and the Python evals, so the evals
  test exactly what production runs. Re-classifying the same posts twice agreed 93.4% of the time.
- **Knowledge graph**: LLM entity extraction (topics, people, brands) with a guardrail that drops
  any entity not quoted verbatim from the caption, auditable entity resolution, and a graph stored
  in Supabase (`supabase/kg_schema.sql`). Built from 732 real posts: 2,677 nodes and 6,903 edges,
  for $0.44. It answers questions the flat metrics can't, such as which topics competitors do well
  with that the target never posts about.

Setup, commands and full results are in [ml/README.md](ml/README.md).

## Tech stack

- **Next.js (TypeScript)** — the web app (form, status page, both report pages)
- **A standalone worker process** — runs the actual pipeline in the background
- **Supabase (Postgres)** — all data: analyses, accounts, posts, computed metrics,
  generated reports
- **Apify** — scraping (Instagram/TikTok/LinkedIn actors + a Social Blade actor for
  growth history)
- **Gemini** (`gemini-3.8-flash`, Google GenAI SDK) — content classification and report
  synthesis
- **Playwright** — renders the live report pages to PDF
- **Python** — the `ml/` evals and knowledge graph (networkx, rapidfuzz)


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
  gemini.ts                    API client setup for each service
  types.ts                     Shared TypeScript types (database rows, metrics shapes)

components/
  charts/                      The four chart components (Recharts)
  reports/                     Report-page building blocks, including OnVibe's brand
                               colors (brand.ts) and the PDF-capture readiness marker

prompts/classify.json        The post-classification prompt, shared by worker/ and ml/

ml/                          Python evals and knowledge graph (see ml/README.md)
  onvibe_ml/evals/             Grounding check and classifier eval
  onvibe_ml/kg/                Entity extraction, resolution, graph build and queries
  reports/                     Generated results (grounding, classifier, graph summary)

supabase/schema.sql          The full database schema
supabase/kg_schema.sql       Knowledge-graph tables (nodes, edges, aliases)

legacy-streamlit-prototype/  The original Python/Streamlit prototype (kept for
                             reference, not part of the running app)
```

## Repo

[github.com/rameenft/onvibe-competitor-analysis](https://github.com/rameenft/onvibe-competitor-analysis)
(public).
