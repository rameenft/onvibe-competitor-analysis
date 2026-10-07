# ml/ — evals and knowledge graph (Python)

A Python layer on top of the TypeScript pipeline. It reads the same Supabase tables the worker
writes and adds two things the pipeline didn't have:

1. **Evals**: is the LLM output actually right?
   - **Classifier eval.** Hand labels, accuracy/F1 reweighted by sampling stratum,
     calibration of the model's own confidence scores, and side-by-side model comparison on the
     exact production prompt.
   - **Grounding check.** Does every number in the LLM-written insights exist in the metrics it
     was given? The checker is itself tested by injecting fake numbers.
2. **A knowledge graph** built from posts. Captions go through LLM entity extraction (with a guardrail
   against hallucinated entities), then entity resolution, giving a temporal graph that can answer
   questions the flat metrics can't (topic gaps vs competitors, shared collaborators).

## Setup

```bash
cd ml
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

It reads `../.env.local` (same file as the worker): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`GEMINI_API_KEY` (default model `gemini-3.8-flash`, override with `GEMINI_MODEL` or `ML_MODEL`).
Claude models work too: pass `--model claude-...` with `ANTHROPIC_API_KEY` set, which is how the
evals compare providers. Run everything from `ml/` as `.venv/bin/python -m onvibe_ml ...`.

## Commands

| Command | Cost | What it does |
| --- | --- | --- |
| `eval grounding` | free | Checks every cited number in stored insights; writes `reports/grounding.md` |
| `label sample` | free | Builds a stratified queue of posts to label (`data/label_queue.csv`) |
| `label` | free | Label the queue in the terminal, resumable; writes `data/gold_labels.csv` |
| `eval classify` | free | Scores production predictions against your labels; writes `reports/classifier_eval.md` |
| `eval classify --model claude-haiku-4-5` | LLM | Also re-runs the production prompt with another model on the same posts |
| `eval agreement --model M` | LLM | Label-free: how often model M agrees with production |
| `kg extract [--analysis ID]` | LLM | Entity extraction, cached per post |
| `kg build [--persist]` | ~1 LLM call | Resolves entities, builds the graph, writes `reports/kg_summary.md`; `--persist` writes to Supabase |
| `kg query gaps --analysis ID` | free | Topics competitors win on that the target never covers |
| `kg query collabs` / `kg query entity --name X` | free | Shared collaborators / one entity's neighborhood |

Tests: `.venv/bin/python -m pytest` (no network or API calls).

## Results so far (real data: 4 analyses, 869 post rows, 732 unique posts)

- **Grounding: 78/78 numeric claims fully grounded** across observations, explanations and
  customer findings: 307 numbers matched directly, 6 as ratios, 0 made up. The checker itself
  catches **95% of injected fake numbers** (420 mutation trials), so the 100% means something.
  The misses are fakes that land on a different real value of the same kind.
- **Production self-consistency: 93.4% (kappa 0.90).** 137 posts were scraped in two analyses
  and classified independently; this is how often the two runs agreed. Most splits are
  collaboration vs product and campaign vs product, the same boundaries the labeling guide's
  tie-breaks address.
- **Gemini vs production (Claude) classifier: 76.7% agreement (kappa 0.66)** on 150 posts, versus
  production's 93.4% agreement with itself. Moving production classification to Gemini would
  change about 1 label in 4, mostly product/other and other/educational. Only hand labels can say
  which model is right, which is the reason the classifier eval exists.
- **Knowledge graph: 2,677 nodes, 6,903 edges**, persisted to Supabase. Extraction over all 732
  posts with `gemini-3.8-flash` cost $0.44. The guardrail dropped 68 of 1,423 entities (4.8%).
  Most drops were correct but unquoted names ("@NASAWebb" -> "James Webb Space Telescope"), so
  it trades a little recall for zero hallucinated entities. Resolution made 43 unique merges,
  including 12 organizations matched to tracked accounts ("Nat Geo" -> National Geographic).
- **Topic gaps for OnVibe** (`kg query gaps`): competitors' above-median topics OnVibe never posts
  about include AI coaching and AI content creation (Stan) and AI advertising, ad creative and
  marketing automation (Predis.ai). Lift on 3-4 posts is directional, not conclusive.
- Accuracy and calibration are pending hand labels (`label`).

## Design notes

- **One prompt, two languages.** The classifier prompt lives in `prompts/classify.json`, read by
  both `worker/pipeline/classify.ts` and this eval. The eval scores exactly what production runs.
- **Stratified sampling with reweighting.** Rare categories (17 paid-promotion posts out of 732)
  are oversampled so per-class numbers mean something. Each label carries its stratum, and the
  overall metrics are reweighted back to population proportions so oversampling doesn't inflate
  them.
- **Labels are a spec.** The production prompt names the 7 categories but never defines them.
  `data/labeling_guide.md` defines them with ordered tie-breaks, and the labels are graded against
  that. The obvious next step is adding those definitions to the prompt and measuring the change.
- **Extraction guardrail.** Every extracted entity must quote its evidence. If the quote isn't
  verbatim in the caption, the entity is dropped and counted, so hallucinated entities never reach
  the graph.
- **Entity resolution is auditable.** Merges happen in three passes (normalize, then fuzzy
  union-find, then matching to a tracked account), plus one LLM pass for topic synonyms that can
  only merge existing labels. Every merge is recorded with its method in `kg_aliases`.
- **Temporal graph.** Node ids are deterministic (`topic:file transfer`,
  `account:instagram:nasa`). The same post or account seen in two analyses is one node, and
  post-derived edges carry `observed_at`. Re-analyzing accounts over time builds up history
  instead of overwriting it.
- **Engagement as lift.** Each post's engagement is divided by its account's median, so a topic
  that works for a 400-follower brand is comparable with one that works for NASA.
