# OnVibe Competitive Analysis

## What this is

A web app that takes a business (name, industry, region, social handles) plus three competitors and
produces one competitive-analysis report, viewable in the browser and downloadable as a PDF.

The report opens with the three most important findings, then goes platform by platform: a
scoreboard of followers, engagement rate and reach, charts, and observations that each cite a
specific number. After that come the content patterns that are working, the target's biggest
competitive gaps, topics competitors win on that the target never covers (from a knowledge graph
built out of the posts), experiments to run next, and a 30/60/90-day plan with success metrics.

Instagram, TikTok and LinkedIn are supported. The report covers the last 90 days.

## How it works

1. **Intake form**: company name, industry, region, platform(s), the target's handle(s), and
   exactly 3 competitors with their handles.
2. **Handle validation**: before anything expensive runs, every handle is checked against the
   platform. A typo'd handle fails right away with a clear error instead of wasting a paid run.
3. **Scraping** (Apify): profile data and the last 90 days of posts for every account, saved to
   Supabase.
4. **Classification** (Gemini): every post is tagged as collaboration, campaign, paid promotion,
   product, testimonial, educational, or other. The prompt in `prompts/classify.json` defines each
   category and gives ordered tie-break rules for posts that fit more than one.
5. **Knowledge graph** (Python, Gemini): entities (topics, people, brands) are extracted from the
   captions, with a guardrail that drops any entity not quoted verbatim from the caption. They are
   resolved into a graph of accounts, posts and topics, which answers questions the flat metrics
   can't: which topics do competitors earn above-normal engagement on that the target never posts
   about? If this step fails, the analysis still completes and the report just leaves out that section.
6. **Metrics**: engagement rate, percentile rank against the competitor set, performance by media
   type and by content category, and collaboration cadence against each account's own organic
   baseline. A "low-sample" guard flags an account with a high engagement rate but a tiny audience
   or a handful of interactions, so a thin sample never reads as outperforming.
7. **Report** (Gemini): one call turns the metrics and the topic gaps into the written report.
8. **PDF** (Playwright): captures the live report page and uploads the PDF to storage.

The pipeline runs in a separate background worker, not inside the web request, so a multi-minute
run doesn't time out or block the app.

## Running it

You need Node 22+, Python 3.13, and accounts for Supabase, Apify and Google Gemini.

1. Copy `.env.example` to `.env.local` and fill in the Supabase, Apify and Gemini keys.
2. In the Supabase SQL editor, run `supabase/schema.sql` and then `supabase/kg_schema.sql`.
3. Install everything, from the repo root:

   ```bash
   npm install && npx playwright install chromium
   cd ml && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
   ```

4. Start the app and the worker in two terminals:

   ```bash
   npm run dev       # the web app on http://localhost:3000
   npm run worker    # the pipeline; picks up analyses submitted in the app
   ```

Submit an analysis at http://localhost:3000. The worker renders the PDF by opening the report page,
so keep `npm run dev` running until the analysis finishes. A run makes paid Apify and Gemini calls.

The worker runs the knowledge-graph step with `ml/.venv/bin/python`. Set `ML_PYTHON` to use a
different interpreter and `KG_TIMEOUT_MS` to change the 10-minute limit for that step.

## Testing and evals

```bash
npm run typecheck && npm run lint && npm test    # TypeScript
cd ml && .venv/bin/python -m pytest              # Python (no network or API calls)
```

CI runs both on every push. The `ml/` package also holds the evals that check the LLM output
against the data: a grounding check that traces every number in the generated text back to the
metrics the model was given, and a classifier eval against hand-labeled posts. It also has the
command line for the knowledge graph. Setup, commands and results are in [ml/README.md](ml/README.md).

## Tech stack

- **Next.js (TypeScript)**: the web app (form, status page, report page)
- **A standalone worker process**: runs the pipeline in the background
- **Supabase (Postgres + Storage)**: analyses, accounts, posts, metrics, reports, the knowledge
  graph, and the PDFs
- **Apify**: scraping (Instagram, TikTok and LinkedIn actors)
- **Gemini** (`gemini-3.8-flash` by default, Google GenAI SDK): classification, entity extraction
  and report writing
- **Playwright**: renders the report page to PDF
- **Python** (networkx, rapidfuzz): the knowledge graph and the evals in `ml/`

## Repo structure

```
app/                        Next.js app: pages and API routes
  page.tsx                    Intake form
  analyses/[id]/page.tsx      Status page (polls pipeline progress)
  analyses/[id]/report/       The report page
  api/analyses/               Create-analysis and status endpoints
  api/validate-handles/       Pre-flight handle validation

worker/                     The background pipeline (a separate always-on process)
  index.ts, core.ts           Polls for new analyses and runs them through the steps
  platforms/                  One file per platform, each with the same fetchProfile/fetchPosts interface
  pipeline/                   One file per step: scrape, classify, graph, metrics, synthesize, render

lib/                        Shared by app/ and worker/
  config.ts                   Environment variables and settings
  supabase.ts, apify.ts,
  gemini.ts                   API clients
  kg.ts                       Reads and groups the knowledge graph's topic gaps
  types.ts                    Shared types (database rows, metrics, report content)

components/
  charts/                     Recharts chart components
  reports/                    Report building blocks: OnVibe branding and the PDF-ready marker

prompts/classify.json       The classification prompt, shared by worker/ and ml/

ml/                         Python knowledge graph and evals (see ml/README.md)
  onvibe_ml/kg/               Entity extraction, resolution, graph build and queries
  onvibe_ml/evals/            Grounding check and classifier eval
  reports/                    Generated results (grounding, classifier, graph summary)

supabase/schema.sql         Core database schema
supabase/kg_schema.sql      Knowledge-graph tables (nodes, edges, aliases)

legacy-streamlit-prototype/ The original Streamlit prototype (kept for reference only)
```

Source: [github.com/rameenft/onvibe-competitor-analysis](https://github.com/rameenft/onvibe-competitor-analysis)
