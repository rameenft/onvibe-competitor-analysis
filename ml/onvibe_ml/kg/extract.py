"""LLM entity extraction from post captions, with a grounding guardrail.

Each post yields topics (short reusable themes) and named entities (products, organizations,
people, campaigns). Every entity must quote the caption span it came from; entities whose
quote isn't actually in the caption are dropped and counted, so hallucinated entities never
reach the graph.

Results are cached per post URL in ml/.cache/kg/, so re-running only pays for new posts and
the same post scraped in two analyses is extracted once.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

from rapidfuzz import fuzz

from ..config import CACHE_DIR, default_model
from ..llm import Usage, call_tool

PROMPT_VERSION = "kg-extract-v1"
BATCH_SIZE = 15
ENTITY_TYPES = ["product", "organization", "person", "campaign"]

SYSTEM_PROMPT = """You extract a knowledge graph from social media posts for a competitive analysis.

For each post, return:
- topics: 1-3 short themes the post is about, as lowercase noun phrases of 1-4 words. Make them
  reusable across companies, so the same theme gets the same wording everywhere ("file transfer",
  "photo backup", "space exploration", "ai video editing"), not post-specific phrasing.
- entities: named things the caption explicitly mentions. Types:
    product: a named product, app, feature, or service (set brand to its maker if the caption says or the
             posting account obviously owns it)
    organization: a named company, brand, institution, or publication other than the posting account itself
    person: a named individual (creator, employee, astronaut, customer)
    campaign: a named campaign, event, launch, contest, or recurring series
  Only extract what is explicitly named in the caption. Do not infer entities from hashtags alone unless the
  hashtag is clearly a name (e.g. #Artemis). Skip generic nouns ("our app", "the team").
  evidence must be an exact, contiguous quote from the caption (at most 12 words) that contains the name.

Return one result for every post_ref you are given, even if its lists are empty."""

EXTRACT_TOOL = {
    "name": "record_extractions",
    "description": "Record the topics and named entities found in each post.",
    "input_schema": {
        "type": "object",
        "properties": {
            "posts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "post_ref": {"type": "string"},
                        "topics": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
                        "entities": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "type": {"type": "string", "enum": ENTITY_TYPES},
                                    "name": {"type": "string"},
                                    "brand": {"type": ["string", "null"]},
                                    "evidence": {"type": "string"},
                                },
                                "required": ["type", "name", "evidence"],
                            },
                        },
                    },
                    "required": ["post_ref", "topics", "entities"],
                },
            }
        },
        "required": ["posts"],
    },
}


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def is_grounded(entity: dict, caption: str) -> bool:
    """The quote must appear verbatim in the caption, and the name must (fuzzily) appear in the quote.

    Fuzzy on the name so light normalization by the model ("Dr.Fone" for "Dr. Fone") still passes.
    """
    caption_n = _squash(caption)
    evidence_n = _squash(entity.get("evidence") or "").strip("\"'“”…. ")
    name_n = _squash(entity.get("name") or "")
    if not evidence_n or not name_n or evidence_n not in caption_n:
        return False
    return fuzz.partial_ratio(name_n, evidence_n) >= 85


def cache_path(model: str):
    path = CACHE_DIR / "kg" / f"extractions__{model}__{PROMPT_VERSION}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_cache(model: str) -> dict[str, dict]:
    path = cache_path(model)
    if not path.exists():
        return {}
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return {row["post_url"]: row for row in rows}


def extract(posts: list[dict], handle_of: dict[str, str], model: str | None = None) -> tuple[dict[str, dict], Usage, dict]:
    """Extract entities for every post not already cached. Returns (by post_url, usage, guardrail stats)."""
    model = model or default_model()
    cached = load_cache(model)
    todo = [p for p in posts if p["post_url"] not in cached and (p.get("caption") or "").strip()]
    batches = [todo[i : i + BATCH_SIZE] for i in range(0, len(todo), BATCH_SIZE)]
    usage = Usage()
    stats = {"kept": 0, "dropped": 0, "dropped_examples": []}

    def run(batch: list[dict]) -> list[dict]:
        refs = {f"p{i + 1}": post for i, post in enumerate(batch)}
        content = "\n\n---\n\n".join(
            f"post_ref: {ref}\nposting_account: @{handle_of[post['account_id']]}\ncaption: {post['caption']}"
            for ref, post in refs.items()
        )
        result = call_tool(model, SYSTEM_PROMPT, EXTRACT_TOOL, content, usage)
        rows = []
        for item in result.get("posts", []):
            post = refs.get(item.get("post_ref"))
            if post is None:
                continue
            kept, dropped = [], []
            for entity in item.get("entities", []):
                (kept if is_grounded(entity, post["caption"]) else dropped).append(entity)
            rows.append(
                {
                    "post_url": post["post_url"],
                    "topics": [t.strip().lower() for t in item.get("topics", []) if t.strip()],
                    "entities": kept,
                    "dropped": dropped,
                }
            )
        return rows

    path = cache_path(model)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for rows in pool.map(run, batches):
            with path.open("a") as f:
                for row in rows:
                    f.write(json.dumps(row) + "\n")
                    cached[row["post_url"]] = row

    for row in cached.values():
        stats["kept"] += len(row["entities"])
        stats["dropped"] += len(row["dropped"])
        if row["dropped"] and len(stats["dropped_examples"]) < 5:
            stats["dropped_examples"].append(row["dropped"][0])
    return cached, usage, stats
