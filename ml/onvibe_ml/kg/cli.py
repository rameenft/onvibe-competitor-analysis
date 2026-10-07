from collections import Counter

from ..config import REPORTS_DIR, default_model
from ..db import load_corpus
from ..llm import Usage
from . import extract, queries, store
from .graph import GraphBuilder
from .resolve import canonicalize_topics


def _unique_posts(corpus: dict, analysis_id: str | None) -> list[dict]:
    accounts = corpus["accounts"]
    unique: dict[str, dict] = {}
    for post in sorted(corpus["posts"], key=lambda p: p["id"]):
        if analysis_id and accounts[post["account_id"]]["analysis_id"] != analysis_id:
            continue
        unique.setdefault(post["post_url"], post)
    return list(unique.values())


def run_extract(model: str, analysis_id: str | None) -> None:
    corpus = load_corpus()
    posts = _unique_posts(corpus, analysis_id)
    handle_of = {aid: a["handle"] for aid, a in corpus["accounts"].items()}
    cached_before = len(extract.load_cache(model))
    results, usage, stats = extract.extract(posts, handle_of, model)
    print(f"Extracted {len(results) - cached_before} new posts ({len(results)} cached total) with {model}.")
    print(f"Cost this run: {usage.summary(model) if usage.calls else 'nothing new to extract'}")
    total = stats["kept"] + stats["dropped"]
    if total:
        print(
            f"Grounding guardrail: kept {stats['kept']} entities, dropped {stats['dropped']} "
            f"({100 * stats['dropped'] / total:.1f}%) whose quote wasn't in the caption."
        )
        for example in stats["dropped_examples"][:3]:
            print(f"  dropped: {example['type']} {example['name']!r} quoting {example['evidence']!r}")


def build(model: str, persist: bool) -> None:
    corpus = load_corpus()
    extractions = extract.load_cache(model)
    if not extractions:
        print(
            "No LLM extractions cached yet (run `python -m onvibe_ml kg extract`), so this builds only the "
            "structural graph: accounts, competitors, posts, hashtags, mentions, co-authors, categories.\n"
        )

    topics = Counter(t for row in extractions.values() for t in row["topics"])
    usage = Usage()
    topic_map = canonicalize_topics(topics, model, usage) if topics else {}
    builder = GraphBuilder(corpus, extractions, topic_map)
    g = builder.build()
    store.save_local(g)

    report = summary(g, builder, topics, topic_map, extractions, corpus)
    REPORTS_DIR.mkdir(exist_ok=True)
    (REPORTS_DIR / "kg_summary.md").write_text(report + "\n")
    print(report)
    if usage.calls:
        print(f"\nTopic canonicalization: {usage.summary(model)}")
    if persist:
        store.save_supabase(g, builder.aliases)


def summary(g, builder: GraphBuilder, topics: Counter, topic_map: dict, extractions: dict, corpus: dict) -> str:
    node_types = Counter(data["type"] for _, data in g.nodes(data=True))
    edge_types = Counter(data["type"] for _, _, data in g.edges(data=True))
    total_posts = len({p["post_url"] for p in corpus["posts"]})
    methods = Counter(m for _, _, m in set(builder.aliases))
    kept = sum(len(r["entities"]) for r in extractions.values())
    dropped = sum(len(r["dropped"]) for r in extractions.values())

    out = ["# Knowledge graph summary", ""]
    out.append(
        f"Built from {total_posts} unique posts ({len(corpus['posts'])} post rows; the same post scraped in two "
        f"analyses is one node), {len(extractions)} with LLM extractions."
    )
    out.append("")
    out.append("| Node type | Count |  | Edge type | Count |")
    out.append("| --- | --- | --- | --- | --- |")
    n_rows = sorted(node_types.items(), key=lambda x: -x[1])
    e_rows = sorted(edge_types.items(), key=lambda x: -x[1])
    for i in range(max(len(n_rows), len(e_rows))):
        n = n_rows[i] if i < len(n_rows) else ("", "")
        e = e_rows[i] if i < len(e_rows) else ("", "")
        out.append(f"| {n[0]} | {n[1]} |  | {e[0]} | {e[1]} |")
    out.append("")
    out.append("## Extraction quality")
    out.append("")
    out.append(
        f"- Grounding guardrail: {kept} entities kept, {dropped} dropped "
        f"({100 * dropped / max(kept + dropped, 1):.1f}%) because their quoted evidence wasn't in the caption."
    )
    out.append(
        f"- Topic canonicalization merged {len(topic_map)} labels into {len(set(topic_map.values()))} canonical "
        f"topics ({len(topics)} raw labels -> {node_types.get('topic', 0)} topic nodes)."
    )
    out.append(
        "- Entity resolution merges (unique surface forms): "
        + (", ".join(f"{n} by {m}" for m, n in methods.most_common()) or "none")
        + "."
    )
    account_matches = sorted({(a, n) for a, n, m in builder.aliases if m == "account-match"})
    if account_matches:
        out.append(
            "- Organizations resolved to tracked accounts: "
            + "; ".join(f"\"{a}\" -> {g.nodes[n]['name']}" for a, n in account_matches[:12])
        )
    out.append("")
    out.append("## Most connected entities")
    out.append("")
    for type_ in ("topic", "organization", "product", "person", "campaign"):
        ranked = sorted(
            ((g.in_degree(nid), data["name"]) for nid, data in g.nodes(data=True) if data["type"] == type_),
            reverse=True,
        )[:8]
        if ranked:
            out.append(f"- **{type_}**: " + ", ".join(f"{name} ({deg})" for deg, name in ranked))
    out.append("")
    out.append("## Example: shared collaborators")
    out.append("")
    out.append("```")
    out.append(queries.shared_collaborators(g))
    out.append("```")
    return "\n".join(out)


def run(args) -> None:
    model = args.model or default_model()
    if args.action == "extract":
        run_extract(model, args.analysis)
    elif args.action == "build":
        build(model, args.persist)
    else:
        g = store.load_local()
        if args.query == "gaps":
            if not args.analysis:
                raise SystemExit("kg query gaps needs --analysis <analysis id>")
            print(queries.topic_gaps(g, args.analysis))
        elif args.query == "collabs":
            print(queries.shared_collaborators(g))
        elif args.query == "entity":
            if not args.name:
                raise SystemExit("kg query entity needs --name <entity name>")
            print(queries.describe_entity(g, args.name))
        else:
            raise SystemExit("kg query needs one of: gaps, collabs, entity")
