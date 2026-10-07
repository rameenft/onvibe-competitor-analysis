"""Persist the graph: always to a local node-link JSON, optionally to Supabase (supabase/kg_schema.sql)."""

import hashlib
import json

import networkx as nx

from ..config import CACHE_DIR
from ..db import client

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


def save_supabase(g: nx.MultiDiGraph, aliases: list[tuple[str, str, str]]) -> None:
    """Replace the graph tables' contents with this build (they're derived data, rebuilt whole)."""
    db = client()
    try:
        db.table("kg_nodes").select("id").limit(1).execute()
    except Exception as exc:  # PostgREST reports a missing table as an API error
        raise SystemExit(
            "kg_nodes table not found. Run supabase/kg_schema.sql in the Supabase SQL editor first."
        ) from exc

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

    # Edges and aliases cascade from nodes.
    db.table("kg_nodes").delete().neq("id", "").execute()
    for rows in _chunks(nodes):
        db.table("kg_nodes").insert(rows).execute()
    for rows in _chunks(edges):
        db.table("kg_edges").insert(rows).execute()
    for rows in _chunks(alias_rows):
        db.table("kg_aliases").insert(rows).execute()
    print(f"Persisted {len(nodes)} nodes, {len(edges)} edges, {len(alias_rows)} aliases to Supabase.")
