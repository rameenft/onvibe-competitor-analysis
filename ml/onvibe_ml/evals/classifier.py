"""Score the post classifier against hand labels, and compare models on the same posts.

Sources of predictions:
  - "production": what the TypeScript worker already stored in post_categories (free).
  - any model id: re-run the shared production prompt (prompts/classify.json) on the
    labeled posts with that model. Results are cached per (model, prompt version).
"""

import json
import random
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

from ..config import CACHE_DIR, DATA_DIR, REPORTS_DIR, load_classify_prompt
from ..db import load_corpus
from ..llm import Usage, call_tool
from . import metrics
from .labeling import SKIP, read_gold, unique_posts

BATCH_SIZE = 40  # same chunk size as worker/pipeline/classify.ts
# Gemini's output budget includes thinking tokens; matches MAX_OUTPUT_TOKENS in lib/gemini.ts.
GEMINI_MAX_OUTPUT_TOKENS = 65536


def classify_with_model(model: str, posts: list[dict]) -> tuple[dict[str, dict], Usage]:
    """Run the production prompt on `posts` with `model`. Returns {post_id: prediction}."""
    prompt = load_classify_prompt()
    cache_path = CACHE_DIR / "classify" / f"{model}__{prompt['version']}.jsonl"
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cached: dict[str, dict] = {}
    if cache_path.exists():
        for line in cache_path.read_text().splitlines():
            row = json.loads(line)
            cached[row["post_id"]] = row

    usage = Usage()
    todo = [p for p in posts if p["id"] not in cached]
    batches = [todo[i : i + BATCH_SIZE] for i in range(0, len(todo), BATCH_SIZE)]

    def run(batch: list[dict]) -> list[dict]:
        # Same per-post layout as classifyChunk() in the TypeScript worker.
        content = "\n\n---\n\n".join(
            f"post_id: {p['id']}\naccount: @{p.get('account_handle', 'unknown')}\ncoauthor_tag: {p['coauthor_handle'] or 'none'}\ncaption: {p['caption'] or '(no caption)'}"
            for p in batch
        )
        result = call_tool(model, prompt["system"], prompt["tool"], content, usage, max_tokens=8192 if model.startswith("claude") else GEMINI_MAX_OUTPUT_TOKENS)
        wanted = {p["id"] for p in batch}
        return [c for c in result.get("classifications", []) if c.get("post_id") in wanted]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for rows in pool.map(run, batches):
            with cache_path.open("a") as f:
                for row in rows:
                    f.write(json.dumps(row) + "\n")
                    cached[row["post_id"]] = row
    return cached, usage


def with_handle(post: dict, corpus: dict) -> dict:
    """Post plus its account's handle, which the prompt shows so the model can spot self-tags."""
    return {**post, "account_handle": corpus["accounts"][post["account_id"]]["handle"]}


def split_table(results: list[dict], gold: list[dict], predictions: dict[str, dict], weights: dict, labels: list[str]) -> list[str]:
    """Accuracy on the tuning labels vs the locked holdout (data/holdout_ids.txt), per source."""
    path = DATA_DIR / "holdout_ids.txt"
    if not path.exists():
        return []
    holdout = set(path.read_text().split())
    lines = ["## Tuning set vs locked holdout", "",
             "The holdout labels were not looked at while the prompt was edited, so it is the honest number.", "",
             "| Source | Tuning accuracy | n | Holdout accuracy | n |", "| --- | --- | --- | --- | --- |"]
    for source, preds in predictions.items():
        cells = []
        for subset in ([r for r in gold if r["post_id"] not in holdout], [r for r in gold if r["post_id"] in holdout]):
            r = score(source, subset, preds, weights, labels)
            cells += [_pct(r["accuracy"]), str(r["n"])]
        lines.append(f"| {source} | " + " | ".join(cells) + " |")
    return lines + [""]


def stratum_weights(corpus: dict, gold: list[dict]) -> dict[str, float]:
    """Inverse sampling-rate weight per stratum, so oversampled rare classes don't skew totals."""
    population = Counter(corpus["categories"][p["id"]]["category"] for p in unique_posts(corpus))
    labeled = Counter(row["stratum"] for row in gold)
    return {s: population[s] / labeled[s] for s in labeled if labeled[s]}


def self_consistency(corpus: dict) -> dict:
    """Production classified some posts twice (same post scraped in two analyses, classified
    independently). How often did it give the same answer? Needs no labels."""
    by_url = defaultdict(list)
    for post in corpus["posts"]:
        if post["id"] in corpus["categories"]:
            by_url[post["post_url"]].append(corpus["categories"][post["id"]]["category"])
    pairs = [(cats[0], cats[1]) for cats in by_url.values() if len(cats) >= 2]
    if not pairs:
        return {"n": 0}
    result = metrics.agreement([a for a, _ in pairs], [b for _, b in pairs])
    result["disagreements"] = Counter(tuple(sorted(p)) for p in pairs if p[0] != p[1]).most_common(5)
    return result


def _pct(x: float) -> str:
    return "n/a" if x != x else f"{100 * x:.1f}%"  # x != x is the NaN check


def score(source: str, gold: list[dict], predictions: dict[str, dict], weights: dict[str, float], labels: list[str]):
    rows = [r for r in gold if r["post_id"] in predictions]
    gold_labels = [r["gold_label"] for r in rows]
    pred_labels = [predictions[r["post_id"]]["category"] for r in rows]
    w = [weights[r["stratum"]] for r in rows]
    conf = [float(predictions[r["post_id"]].get("confidence") or 0.0) for r in rows]
    correct = [g == p for g, p in zip(gold_labels, pred_labels)]

    per_class = metrics.per_class(gold_labels, pred_labels, labels, w)
    ece, bins = metrics.expected_calibration_error(conf, correct, w)
    return {
        "source": source,
        "n": len(rows),
        "accuracy": metrics.weighted_accuracy(gold_labels, pred_labels, w),
        "macro_f1": metrics.macro_f1(per_class),
        "per_class": per_class,
        "confusion": metrics.confusion(gold_labels, pred_labels, labels),
        "ece": ece,
        "bins": bins,
        "selective": metrics.selective_accuracy(conf, correct, w),
        "errors": [
            (r["post_id"], g, p, predictions[r["post_id"]].get("rationale", ""))
            for r, g, p in zip(rows, gold_labels, pred_labels)
            if g != p
        ],
    }


def render(results: list[dict], labels: list[str], consistency: dict, agreements: dict, costs: dict) -> str:
    out = ["# Classifier eval", ""]
    if results:
        out.append(
            f"Gold set: {results[0]['n']} hand-labeled posts (see `ml/data/labeling_guide.md`). Overall numbers are "
            "reweighted by sampling stratum, so they estimate performance on the full post population; "
            "the confusion matrix shows raw counts."
        )
        out.append("")
        out.append("## Summary")
        out.append("")
        out.append("| Source | Accuracy | Macro-F1 | ECE (calibration error) | Agreement with production (kappa) | Cost |")
        out.append("| --- | --- | --- | --- | --- | --- |")
        for r in results:
            agree = agreements.get(r["source"])
            agree_text = f"{_pct(agree['raw'])} ({agree['kappa']:.2f})" if agree else "-"
            out.append(
                f"| {r['source']} | {_pct(r['accuracy'])} | {r['macro_f1']:.3f} | {r['ece']:.3f} | {agree_text} | {costs.get(r['source'], '-')} |"
            )
        out.append("")

    if consistency.get("n"):
        out.append("## Production self-consistency (no labels needed)")
        out.append("")
        out.append(
            f"{consistency['n']} posts were scraped in two analyses and classified independently each time. "
            f"The two runs agreed on {_pct(consistency['raw'])} of them (kappa {consistency['kappa']:.2f})."
        )
        if consistency["disagreements"]:
            pairs = ", ".join(f"{a} / {b} ({n})" for (a, b), n in consistency["disagreements"])
            out.append(f"Most common splits: {pairs}.")
        out.append("")

    for r in results:
        out.append(f"## {r['source']}")
        out.append("")
        out.append("| Category | Precision | Recall | F1 | Gold support (weighted) |")
        out.append("| --- | --- | --- | --- | --- |")
        for c in r["per_class"]:
            out.append(f"| {c.label} | {_pct(c.precision)} | {_pct(c.recall)} | {c.f1:.3f} | {c.support:.1f} |")
        out.append("")
        out.append("Confusion matrix (rows = gold, columns = predicted, raw counts):")
        out.append("")
        short = [l[:6] for l in labels]
        out.append("| gold \\ pred | " + " | ".join(short) + " |")
        out.append("| --- " * (len(labels) + 1) + "|")
        for label, row in zip(labels, r["confusion"]):
            out.append(f"| {label} | " + " | ".join(str(v) for v in row) + " |")
        out.append("")
        out.append("Calibration (does stated confidence match observed accuracy?):")
        out.append("")
        out.append("| Confidence bin | Mean confidence | Accuracy | Posts |")
        out.append("| --- | --- | --- | --- |")
        for b in r["bins"]:
            lo, hi = b["range"]
            out.append(f"| {lo:.1f}-{hi:.1f} | {b['mean_confidence']:.2f} | {_pct(b['accuracy'])} | {b['count']} |")
        out.append("")
        out.append("If we only trusted predictions above a confidence threshold:")
        out.append("")
        out.append("| Threshold | Coverage | Accuracy |")
        out.append("| --- | --- | --- |")
        for s in r["selective"]:
            out.append(f"| >= {s['threshold']:.1f} | {_pct(s['coverage'])} | {_pct(s['accuracy'])} |")
        out.append("")
        if r["errors"]:
            out.append(f"<details><summary>{len(r['errors'])} misclassified posts</summary>")
            out.append("")
            out.append("| post_id | gold | predicted | model's rationale |")
            out.append("| --- | --- | --- | --- |")
            for post_id, g, p, why in r["errors"]:
                out.append(f"| `{post_id[:8]}` | {g} | {p} | {why.replace('|', '/')} |")
            out.append("")
            out.append("</details>")
            out.append("")
    return "\n".join(out)


def run(models: list[str]) -> str:
    corpus = load_corpus()
    labels = load_classify_prompt()["categories"]
    consistency = self_consistency(corpus)

    gold = [r for r in read_gold() if r["gold_label"] != SKIP]
    if not gold:
        report = render([], labels, consistency, {}, {}) + (
            "\n_No gold labels yet, so accuracy and calibration aren't measured. Run "
            "`python -m onvibe_ml label` to hand-label the queue in `ml/data/label_queue.csv`._"
        )
        REPORTS_DIR.mkdir(exist_ok=True)
        (REPORTS_DIR / "classifier_eval.md").write_text(report + "\n")
        return report

    weights = stratum_weights(corpus, gold)
    production = {pid: corpus["categories"][pid] for pid in (r["post_id"] for r in gold)}
    results = [score("production", gold, production, weights, labels)]
    agreements, costs = {}, {}
    all_predictions = {"production": production}

    posts_by_id = {p["id"]: p for p in corpus["posts"]}
    gold_posts = [with_handle(posts_by_id[r["post_id"]], corpus) for r in gold]
    for model in models:
        predictions, usage = classify_with_model(model, gold_posts)
        results.append(score(model, gold, predictions, weights, labels))
        all_predictions[model] = predictions
        shared = [r["post_id"] for r in gold if r["post_id"] in predictions]
        agreements[model] = metrics.agreement(
            [production[p]["category"] for p in shared], [predictions[p]["category"] for p in shared]
        )
        costs[model] = usage.summary(model) if usage.calls else "cached"

    report = render(results, labels, consistency, agreements, costs)
    extra = split_table(results, gold, all_predictions, weights, labels)
    if extra:
        head, sep, rest = report.partition("\n## Production self-consistency")
        report = head + "\n" + "\n".join(extra) + sep + rest
    REPORTS_DIR.mkdir(exist_ok=True)
    (REPORTS_DIR / "classifier_eval.md").write_text(report + "\n")
    return report


def run_agreement(model: str, sample_size: int, seed: int = 7) -> str:
    """Label-free comparison: how often does `model` agree with production on a random sample?"""
    corpus = load_corpus()
    posts = unique_posts(corpus)
    sample = [with_handle(p, corpus) for p in random.Random(seed).sample(posts, min(sample_size, len(posts)))]
    predictions, usage = classify_with_model(model, sample)
    shared = [p["id"] for p in sample if p["id"] in predictions]
    production = [corpus["categories"][p]["category"] for p in shared]
    candidate = [predictions[p]["category"] for p in shared]
    result = metrics.agreement(production, candidate)
    flips = Counter((a, b) for a, b in zip(production, candidate) if a != b).most_common(8)
    lines = [
        f"{model} vs production on {result['n']} posts: agreement {_pct(result['raw'])}, kappa {result['kappa']:.2f}",
        f"Cost: {usage.summary(model) if usage.calls else 'cached'}",
        "Most common disagreements (production -> candidate):",
        *[f"  {a} -> {b}: {n}" for (a, b), n in flips],
        "Agreement isn't accuracy: without gold labels this can't say which model is right.",
    ]
    return "\n".join(lines)
