"""Questions the graph can answer that the flat metrics tables can't."""

import statistics
from collections import defaultdict

import networkx as nx
from rapidfuzz import fuzz, process


def _posts_of(g: nx.MultiDiGraph, account: str) -> list[str]:
    return [dst for _, dst, k in g.out_edges(account, keys=True) if k == "POSTED"]


def _targets(g: nx.MultiDiGraph, post: str, edge_type: str) -> list[str]:
    return [dst for _, dst, data in g.out_edges(post, data=True) if data["type"] == edge_type]


def analysis_accounts(g: nx.MultiDiGraph, analysis_id: str) -> tuple[str | None, list[str]]:
    """(target account, competitor accounts) for one analysis, from its COMPETES_WITH edges."""
    target, rivals = None, []
    for src, dst, data in g.edges(data=True):
        if data["type"] == "COMPETES_WITH" and data.get("analysis_id") == analysis_id:
            target = src
            rivals.append(dst)
    return target, sorted(set(rivals))


def topic_table(g: nx.MultiDiGraph, accounts: list[str]) -> dict[str, dict[str, list[float]]]:
    """topic -> account -> list of post lifts."""
    table: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for account in accounts:
        for post in _posts_of(g, account):
            lift = g.nodes[post].get("lift")
            for topic in _targets(g, post, "ABOUT"):
                table[topic][account].append(lift if lift is not None else 0.0)
    return table


def topic_gaps(g: nx.MultiDiGraph, analysis_id: str, min_posts: int = 3) -> str:
    """Topics competitors post about that work for them (lift > 1) and the target never covers,
    plus topics only the target covers. Lift = post engagement / that account's median, so it's
    comparable across accounts of very different size."""
    target, rivals = analysis_accounts(g, analysis_id)
    if not target:
        return f"No analysis {analysis_id} in the graph."
    table = topic_table(g, [target, *rivals])

    gaps, owned = [], []
    for topic, by_account in table.items():
        rival_lifts = [lift for a in rivals for lift in by_account.get(a, [])]
        target_lifts = by_account.get(target, [])
        if not target_lifts and len(rival_lifts) >= min_posts:
            median = statistics.median(rival_lifts)
            if median >= 1.0:
                who = sorted({g.nodes[a]["name"] for a in rivals if by_account.get(a)})
                gaps.append((median, len(rival_lifts), g.nodes[topic]["name"], who))
        if target_lifts and not rival_lifts:
            owned.append((statistics.median(target_lifts), len(target_lifts), g.nodes[topic]["name"]))

    lines = [f"Topic gaps for {g.nodes[target]['name']} vs {', '.join(g.nodes[r]['name'] for r in rivals)}", ""]
    lines.append("Topics competitors use with above-median engagement that the target never posts about:")
    lines.append(f"{'median lift':>12}  {'posts':>5}  topic  (who)")
    for median, n, name, who in sorted(gaps, reverse=True)[:15]:
        lines.append(f"{median:>12.2f}  {n:>5}  {name}  ({', '.join(who)})")
    if not gaps:
        lines.append("  (none)")
    lines.append("")
    lines.append("Topics only the target covers:")
    for median, n, name in sorted(owned, reverse=True)[:10]:
        lines.append(f"{median:>12.2f}  {n:>5}  {name}")
    if not owned:
        lines.append("  (none)")
    return "\n".join(lines)


def shared_collaborators(g: nx.MultiDiGraph, min_accounts: int = 2) -> str:
    """People, organizations, and outside accounts that more than one tracked account features."""
    featured_by: dict[str, set[str]] = defaultdict(set)
    for account, data in g.nodes(data=True):
        if data["type"] != "account" or not data.get("tracked"):
            continue
        for post in _posts_of(g, account):
            for _, dst, edge in g.out_edges(post, data=True):
                if edge["type"] in ("MENTIONS", "COLLABORATED_WITH") and g.nodes[dst]["type"] in (
                    "account", "person", "organization", "company"
                ):
                    if dst != account:
                        featured_by[dst].add(account)

    rows = [(len(accts), node, accts) for node, accts in featured_by.items() if len(accts) >= min_accounts]
    lines = [f"Entities featured by {min_accounts}+ tracked accounts:"]
    for count, node, accts in sorted(rows, key=lambda r: (-r[0], g.nodes[r[1]]["name"])):
        data = g.nodes[node]
        names = ", ".join(sorted(g.nodes[a]["name"] for a in accts))
        lines.append(f"  {data['name']} [{data['type']}] <- {names}")
    if not rows:
        lines.append("  (none)")
    return "\n".join(lines)


def describe_entity(g: nx.MultiDiGraph, name: str) -> str:
    """Fuzzy-find a node by name and summarize its neighborhood."""
    candidates = {nid: data["name"] for nid, data in g.nodes(data=True) if data["type"] != "post"}
    match = process.extractOne(name, candidates, scorer=fuzz.WRatio)
    if not match or match[1] < 70:
        return f"Nothing in the graph matches {name!r}."
    nid = match[2]
    data = g.nodes[nid]
    lines = [f"{data['name']}  [{data['type']}]  id={nid}"]
    if data.get("first_seen"):
        lines.append(f"  seen {data['first_seen'][:10]} -> {data['last_seen'][:10]}")

    posts = [src for src, _, e in g.in_edges(nid, data=True) if g.nodes[src]["type"] == "post"]
    if posts:
        by_account = defaultdict(int)
        topics = defaultdict(int)
        for post in posts:
            by_account[g.nodes[post]["account"]] += 1
            for topic in _targets(g, post, "ABOUT"):
                topics[g.nodes[topic]["name"]] += 1
        lifts = [g.nodes[p]["lift"] for p in posts if g.nodes[p].get("lift") is not None]
        lines.append(f"  in {len(posts)} posts, median lift {statistics.median(lifts):.2f}" if lifts else f"  in {len(posts)} posts")
        lines.append("  by: " + ", ".join(f"{g.nodes[a]['name']} ({n})" for a, n in sorted(by_account.items(), key=lambda x: -x[1])))
        top = sorted(topics.items(), key=lambda x: -x[1])[:6]
        if top:
            lines.append("  alongside topics: " + ", ".join(f"{t} ({n})" for t, n in top))

    for _, dst, e in g.out_edges(nid, data=True):
        if g.nodes[dst]["type"] != "post":
            lines.append(f"  -{e['type']}-> {g.nodes[dst]['name']} [{g.nodes[dst]['type']}]")
    for src, _, e in g.in_edges(nid, data=True):
        if g.nodes[src]["type"] not in ("post",):
            lines.append(f"  <-{e['type']}- {g.nodes[src]['name']} [{g.nodes[src]['type']}]")
    return "\n".join(lines)
