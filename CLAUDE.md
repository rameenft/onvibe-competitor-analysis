@AGENTS.md

## Pending: hand-labeling posts for the classifier eval

The `ml/` Python layer (evals + knowledge graph, see `ml/README.md`) is waiting on hand labels
before it can report classifier accuracy and calibration. When the user wants to label:

1. Open the labeler in a Terminal tab for them (it is interactive; don't run it through Bash):
   `.venv/bin/python -m onvibe_ml label`, with cwd `ml/`.
   If `ml/.venv` is missing: `cd ml && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.
2. Explain the keys: `1`-`7` pick a category, `s` skips an unclear post, `g` shows the
   definitions (`ml/data/labeling_guide.md`), `q` saves and quits. Progress is saved after every
   post to `ml/data/gold_labels.csv` and resumes where it left off. The queue
   (`ml/data/label_queue.csv`, 205 posts) is shuffled, so 60-80 labels already give a usable result.
3. Check progress with `.venv/bin/python -m onvibe_ml label status`.
4. When they stop, run `.venv/bin/python -m onvibe_ml eval classify` (free, scores production)
   and `.venv/bin/python -m onvibe_ml eval classify --model gemini-3.8-flash` (re-runs Gemini on
   the labeled posts, a few cents) and walk them through `ml/reports/classifier_eval.md`. The
   open question it answers: Gemini agrees with the production Claude classifier on only 76.7% of
   posts, so which one is right decides whether the live worker should move to Gemini.

Keys live in `.env.local`: `GEMINI_API_KEY` is used by `ml/`; `ANTHROPIC_API_KEY` is empty locally
(the live worker uses the GitHub Actions secret).
