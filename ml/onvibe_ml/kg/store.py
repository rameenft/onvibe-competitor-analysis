"""Persist the graph: always to a local node-link JSON, optionally to Supabase (supabase/kg_schema.sql)."""

import hashlib
import json
from datetime import datetime, timezone

import networkx as nx

from ..config import CACHE_DIR
from ..db import IN_CHUNK, client

GRAPH_PATH = CACHE_DIR / "kg" / "graph.json"
CHUNK = 500
NODE_COLUMNS = {"type", "name", "first_seen", "last_seen"}
EDGE_COLUMNS = {"type", "analysis_id", "observed_at"}


def save_local(g: nx.MultiDiGraph) -> None:
    GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_PATH.write_text(json.dumps(nx.node_link_data(g, edges="edges"), default=str))


def load_local() -> nx.MultiDiGraph:
    if not GRAPH_PATH.exists():
        raise SystemExit("No graph built yet. Run: python -m onvibe_ml kg build")
    return nx.node_link_graph(json.loads(GRAPH_PATH.read_text()), multigraph=True, directed=True, edges="edges")


def _edge_id(src: str, key: str, dst: str) -> str:
    return hashlib.sha1(f"{src}|{key}|{dst}".encode()).hexdigest()


def _chunks(rows: list[dict]):
    for i in range(0, len(rows), CHUNK):
        yield rows[i : i + CHUNK]


def _require_tables(db) -> None:
    try:
        db.table("kg_nodes").select("id").limit(1).execute()
    except Exception as exc:  # PostgREST reports a missing table as an API error
        raise SystemExit(
            "kg_nodes table not found. Run supabase/kg_schema.sql in the Supabase SQL editor first."
        ) from exc


def _rows(g: nx.MultiDiGraph, aliases: list[tuple[str, str, str]]) -> tuple[list[dict], list[dict], list[dict]]:
    nodes = [
        {
            "id": nid,
            **{k: v for k, v in data.items() if k in NODE_COLUMNS},
            "properties": {k: v for k, v in data.items() if k not in NODE_COLUMNS},
        }
        for nid, data in g.nodes(data=True)
    ]
    edges = [
        {
            "id": _edge_id(src, key, dst),
            "src": src,
            "dst": dst,
            **{k: v for k, v in data.items() if k in EDGE_COLUMNS},
            "properties": {k: v for k, v in data.items() if k not in EDGE_COLUMNS},
        }
        for src, dst, key, data in g.edges(keys=True, data=True)
    ]
    alias_rows = list({(a, n): {"alias": a, "node_id": n, "method": m} for a, n, m in aliases if n in g}.values())
    return nodes, edges, alias_rows


def save_supabase(g: nx.MultiDiGraph, aliases: list[tuple[str, str, str]]) -> None:
    """Replace the graph tables' contents with this build (they're derived data, rebuilt whole)."""
    db = client()
    _require_tables(db)
    nodes, edges, alias_rows = _rows(g, aliases)

    # Edges and aliases cascade from nodes.
    db.table("kg_nodes").delete().neq("id", "").execute()
    for rows in _chunks(nodes):
        db.table("kg_nodes").insert(rows).execute()
    for rows in _chunks(edges):
        db.table("kg_edges").insert(rows).execute()
    for rows in _chunks(alias_rows):
        db.table("kg_aliases").insert(rows).execute()
    print(f"Persisted {len(nodes)} nodes, {len(edges)} edges, {len(alias_rows)} aliases to Supabase.")


def _merge_seen(db, nodes: list[dict]) -> None:
    """A node shared with an earlier analysis (an account, a topic) keeps the widest first/last_seen."""
    existing: dict[str, dict] = {}
    ids = [n["id"] for n in nodes]
    for i in range(0, len(ids), IN_CHUNK):
        rows = db.table("kg_nodes").select("id, first_seen, last_seen").in_("id", ids[i : i + IN_CHUNK]).execute().data
        existing.update({r["id"]: r for r in rows})
    for node in nodes:
        old = existing.get(node["id"])
        if not old:
            continue
        # Parse before comparing: Postgres returns "+00:00", the builder carries the scraper's "Z".
        for column, pick in (("first_seen", min), ("last_seen", max)):
            values = [v for v in (old.get(column), node.get(column)) if v]
            if values:
                node[column] = pick(values, key=_instant)


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def save_supabase_analysis(
    g: nx.MultiDiGraph, aliases: list[tuple[str, str, str]], analysis_id: str, post_nodes: list[str]
) -> None:
    """Write one analysis' graph without touching the rest of the tables.

    Nodes and edges are upserted by their deterministic ids, so an account, topic or post shared with
    another analysis is updated in place. Edges this analysis derives from its own posts and its
    COMPETES_WITH edges are deleted first, so re-running it (say, after topic labels were regrouped)
    leaves no stale edges behind. Other analyses' edges are never deleted."""
    db = client()
    _require_tables(db)
    nodes, edges, alias_rows = _rows(g, aliases)
    _merge_seen(db, nodes)

    for i in range(0, len(post_nodes), IN_CHUNK):
        ids = post_nodes[i : i + IN_CHUNK]
        db.table("kg_edges").delete().in_("src", ids).execute()  # ABOUT, IN_CATEGORY, TAGGED, MENTIONS, ...
        db.table("kg_edges").delete().eq("type", "POSTED").in_("dst", ids).execute()
    db.table("kg_edges").delete().eq("type", "COMPETES_WITH").eq("analysis_id", analysis_id).execute()

    built_at = datetime.now(timezone.utc).isoformat()
    for rows in _chunks([{**n, "built_at": built_at} for n in nodes]):
        db.table("kg_nodes").upsert(rows, on_conflict="id").execute()
    for rows in _chunks(edges):
        db.table("kg_edges").upsert(rows, on_conflict="id").execute()
    for rows in _chunks(alias_rows):
        db.table("kg_aliases").upsert(rows, on_conflict="alias,node_id").execute()
    print(f"Upserted {len(nodes)} nodes, {len(edges)} edges, {len(alias_rows)} aliases for analysis {analysis_id}.")
