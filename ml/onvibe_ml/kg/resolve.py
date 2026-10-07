"""Entity resolution: decide which surface strings refer to the same real-world thing.

Three passes, cheapest first, each one recorded as an alias with the method that produced it
so every merge is auditable:
  1. normalize   - casefold, strip @/#, punctuation, and corporate suffixes ("Inc", ".ai")
  2. fuzzy       - union-find over token-sort similarity within an entity type
  3. account     - an extracted organization that is really one of the tracked accounts
                   ("Stan" -> @stanforcreators) is merged into that account's company node
Topics get an optional 4th pass: one LLM call that groups synonyms ("phone cleanup" /
"phone storage cleanup") into a canonical theme, validated so it can only merge, never invent.
"""

import json
import re
import hashlib
from collections import Counter
from dataclasses import dataclass, field

from rapidfuzz import fuzz

from ..config import CACHE_DIR
from ..llm import Usage, call_tool

FUZZY_THRESHOLD = 92
CORPORATE_SUFFIXES = r"\b(inc|llc|ltd|co|corp|corporation|company|official|app|hq)\b|\.(com|ai|io|co|app)\b"
MIN_PREFIX_MATCH = 4  # "stan" may match @stanforcreators; "nat" may not match @natgeo


def normalize(name: str) -> str:
    text = name.casefold().strip()
    text = re.sub(r"^[@#]+", "", text)
    text = re.sub(CORPORATE_SUFFIXES, " ", text)
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"_", " ", text)
    return re.sub(r"\s+", " ", text).strip()


@dataclass
class Resolution:
    canonical: dict[str, str] = field(default_factory=dict)  # normalized surface -> canonical key
    display: dict[str, str] = field(default_factory=dict)  # canonical key -> display name
    aliases: list[tuple[str, str, str]] = field(default_factory=list)  # (surface, canonical key, method)

    def key_for(self, surface: str) -> str | None:
        return self.canonical.get(normalize(surface))


class _UnionFind:
    def __init__(self, items):
        self.parent = {i: i for i in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        self.parent[self.find(a)] = self.find(b)


def resolve_names(surfaces: Counter, threshold: int = FUZZY_THRESHOLD) -> Resolution:
    """Cluster surface strings of one entity type. Canonical name = most frequent surface form."""
    by_norm: dict[str, Counter] = {}
    for surface, count in surfaces.items():
        norm = normalize(surface)
        if norm:
            by_norm.setdefault(norm, Counter())[surface] += count

    norms = sorted(by_norm)
    uf = _UnionFind(norms)
    for i, a in enumerate(norms):
        for b in norms[i + 1 :]:
            if fuzz.token_sort_ratio(a, b) >= threshold:
                uf.union(a, b)

    clusters: dict[str, list[str]] = {}
    for norm in norms:
        clusters.setdefault(uf.find(norm), []).append(norm)

    res = Resolution()
    for members in clusters.values():
        totals = Counter()
        for norm in members:
            totals.update(by_norm[norm])
        display = max(totals, key=lambda s: (totals[s], -len(s)))
        key = normalize(display)
        res.display[key] = display
        for norm in members:
            res.canonical[norm] = key
            for surface in by_norm[norm]:
                if surface != display:
                    res.aliases.append((surface, key, "normalize" if norm == key else "fuzzy"))
    return res


def match_account(name: str, accounts: list[dict]) -> dict | None:
    """Is an extracted organization actually one of the tracked accounts?"""
    norm = normalize(name)
    if not norm:
        return None
    squashed = norm.replace(" ", "")

    def names(account: dict) -> set[str]:
        raw = {account["handle"], account.get("company") or "", account.get("display_name") or ""}
        return {normalize(n).replace(" ", "") for n in raw} - {""}

    # Strictest test first across *all* accounts, so "Wondershare" lands on @wondershare
    # rather than prefix-matching @wondershare_dr.fone because that account came first.
    tests = [
        lambda c: squashed == c,
        lambda c: fuzz.ratio(squashed, c) >= FUZZY_THRESHOLD,
        lambda c: len(squashed) >= MIN_PREFIX_MATCH and c.startswith(squashed),
    ]
    for test in tests:
        for account in accounts:
            if any(test(c) for c in names(account)):
                return account
    return None


TOPIC_TOOL = {
    "name": "group_topics",
    "description": "Group topic labels that mean the same thing under one canonical label.",
    "input_schema": {
        "type": "object",
        "properties": {
            "groups": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "canonical": {"type": "string", "description": "One of the member labels, the clearest one."},
                        "members": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["canonical", "members"],
                },
            }
        },
        "required": ["groups"],
    },
}

TOPIC_SYSTEM = """You are deduplicating topic labels in a knowledge graph. Group labels only when they name the
same theme (synonyms, singular/plural, word order, a needlessly specific variant). Do not group labels that are
merely related ("rocket launch" and "mars exploration" stay separate). The canonical label must be one of the
group's members, copied exactly. Labels that have no synonym can be left out."""


def canonicalize_topics(topics: Counter, model: str, usage: Usage) -> dict[str, str]:
    """One LLM pass mapping topic -> canonical topic. Cached by the exact topic list."""
    labels = sorted(topics)
    digest = hashlib.sha256(json.dumps([model, labels]).encode()).hexdigest()[:16]
    path = CACHE_DIR / "kg" / f"topic_groups__{digest}.json"
    if path.exists():
        return json.loads(path.read_text())

    listing = "\n".join(f"{label} ({topics[label]} posts)" for label in labels)
    result = call_tool(model, TOPIC_SYSTEM, TOPIC_TOOL, listing, usage)
    known = set(labels)
    mapping: dict[str, str] = {}
    for group in result.get("groups", []):
        members = [m for m in group.get("members", []) if m in known and m not in mapping]
        canonical = group.get("canonical")
        # Guardrail: the model may only merge existing labels, never rename to a new one.
        if canonical not in known or len(members) < 2:
            continue
        for member in members:
            mapping[member] = canonical
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(mapping, indent=1))
    return mapping
