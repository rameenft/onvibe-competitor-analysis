"""Assemble the knowledge graph from Supabase rows + cached LLM extractions.

Node ids are deterministic ("type:key"), so rebuilding is idempotent and the same real-world
thing seen in two analyses is one node. Edges that come from a post carry `observed_at`
(the post's timestamp) and edges from an analysis carry `analysis_id`, so the graph keeps
history: it can answer "what did this competitor start talking about recently" as accounts
get re-analyzed.

Node types: company, account, post, category, hashtag, topic, product, organization, person, campaign
Edge types: OPERATES, COMPETES_WITH, POSTED, IN_CATEGORY, TAGGED, MENTIONS, COLLABORATED_WITH,
            ABOUT, PART_OF, MADE_BY
"""

import hashlib
import re
import statistics
from collections import Counter

import networkx as nx

from .resolve import Resolution, match_account, normalize, resolve_names

HASHTAG_RE = re.compile(r"(?<![\w&])#(\w+)")
MENTION_RE = re.compile(r"(?<![\w])@([\w.]*\w)")  # drops a trailing "." ("@hulu." -> hulu)


def post_node(url: str) -> str:
    return "post:" + hashlib.sha1(url.encode()).hexdigest()[:12]


def account_node(platform: str, handle: str) -> str:
    return f"account:{platform}:{handle.lower()}"


def company_name(account: dict, analysis: dict | None) -> str:
    """The brand behind an account: the intake form's company name for a target when it plausibly
    names that account, else a cleaned display name. (A test run submitted @nasa as "Dispatch Test".)"""
    display = account.get("display_name") or account["handle"]
    # "Stan — Your All-in-One Creator Store" -> "Stan"; "CleanMy®Phone by MacPaw" -> "CleanMy®Phone"
    cleaned = re.split(r"\s+(?:—|-|\||by)\s+", display)[0].strip()
    if account["role"] == "target" and analysis:
        given = analysis["company_name"]
        if match_account(given, [{"handle": account["handle"], "display_name": display}]):
            return given
    return cleaned


class GraphBuilder:
    def __init__(self, corpus: dict, extractions: dict[str, dict], topic_map: dict[str, str] | None = None):
        self.corpus = corpus
        self.extractions = extractions
        self.topic_map = topic_map or {}
        self.g = nx.MultiDiGraph()
        self.aliases: list[tuple[str, str, str]] = []  # (surface, node id, method)

    # -- helpers ---------------------------------------------------------------------------

    def node(self, node_id: str, type_: str, name: str, **attrs) -> str:
        if node_id not in self.g:
            self.g.add_node(node_id, type=type_, name=name, **attrs)
        else:
            for key, value in attrs.items():
                if value is not None:
                    self.g.nodes[node_id][key] = value
        return node_id

    def edge(self, src: str, dst: str, type_: str, key: str | None = None, **attrs) -> None:
        key = key or type_
        if self.g.has_edge(src, dst, key):
            return
        self.g.add_edge(src, dst, key=key, type=type_, **attrs)

    # -- build -----------------------------------------------------------------------------

    def build(self) -> nx.MultiDiGraph:
        self._accounts_and_companies()
        posts = self._posts()
        self._entities(posts)
        self._timestamps()
        return self.g

    def _accounts_and_companies(self) -> None:
        analyses = self.corpus["analyses"]
        self.account_rows = []
        latest: dict[str, dict] = {}
        for account in self.corpus["accounts"].values():
            nid = account_node(account["platform"], account["handle"])
            if nid not in latest or (account.get("scraped_at") or "") > (latest[nid].get("scraped_at") or ""):
                latest[nid] = account

        for account in self.corpus["accounts"].values():
            nid = account_node(account["platform"], account["handle"])
            analysis = analyses.get(account["analysis_id"])
            current = latest[nid]
            self.node(
                nid,
                "account",
                "@" + account["handle"],
                handle=account["handle"],
                platform=account["platform"],
                followers=current.get("followers"),
                display_name=current.get("display_name"),
                tracked=True,
            )
            company = company_name(account, analysis)
            cid = self.node(f"company:{normalize(company)}", "company", company)
            self.edge(cid, nid, "OPERATES")
            self.account_rows.append({**account, "company": company, "node": nid, "company_node": cid})

        # Target -> competitor, once per analysis, so repeated analyses show up as history.
        by_analysis: dict[str, list[dict]] = {}
        for row in self.account_rows:
            by_analysis.setdefault(row["analysis_id"], []).append(row)
        for analysis_id, rows in by_analysis.items():
            created = analyses.get(analysis_id, {}).get("created_at")
            for target in (r for r in rows if r["role"] == "target"):
                for rival in (r for r in rows if r["role"] == "competitor" and r["platform"] == target["platform"]):
                    self.edge(
                        target["node"], rival["node"], "COMPETES_WITH", key=f"COMPETES_WITH:{analysis_id}",
                        analysis_id=analysis_id, observed_at=created,
                    )

    def _posts(self) -> list[tuple[str, dict]]:
        """One node per post URL, with engagement relative to the account's own median (lift)."""
        accounts = self.corpus["accounts"]
        unique: dict[str, dict] = {}
        for post in sorted(self.corpus["posts"], key=lambda p: p["id"]):
            unique.setdefault(post["post_url"], post)

        engagement_by_account: dict[str, list[int]] = {}
        for post in unique.values():
            account = accounts[post["account_id"]]
            engagement_by_account.setdefault(account_node(account["platform"], account["handle"]), []).append(
                post["likes"] + post["comments"]
            )
        baseline = {aid: statistics.median(vals) for aid, vals in engagement_by_account.items()}
        self.baselines = baseline

        categories = self.corpus["categories"]
        out = []
        for url, post in unique.items():
            account = accounts[post["account_id"]]
            aid = account_node(account["platform"], account["handle"])
            engagement = post["likes"] + post["comments"]
            base = baseline[aid]
            pid = self.node(
                post_node(url),
                "post",
                (post["caption"] or "")[:80].replace("\n", " "),
                url=url,
                platform=post["platform"],
                posted_at=post["posted_at"],
                media_type=post["media_type"],
                likes=post["likes"],
                comments=post["comments"],
                views=post["views"],
                engagement=engagement,
                # Lift vs the account's own median makes a 40-like post at a 400-follower brand
                # comparable to a 300K-like post at NASA.
                lift=round(engagement / base, 3) if base > 0 else None,
                account=aid,
            )
            self.edge(aid, pid, "POSTED", observed_at=post["posted_at"])

            category = categories.get(post["id"], {}).get("category")
            if category:
                self.edge(pid, self.node(f"category:{category}", "category", category), "IN_CATEGORY")

            caption = post["caption"] or ""
            for tag in {t.lower() for t in HASHTAG_RE.findall(caption)}:
                self.edge(pid, self.node(f"hashtag:{tag}", "hashtag", "#" + tag), "TAGGED", observed_at=post["posted_at"])

            for handle in {h.lower() for h in MENTION_RE.findall(caption)} - {account["handle"].lower()}:
                mid = account_node(post["platform"], handle)
                self.node(mid, "account", "@" + handle, handle=handle, platform=post["platform"])
                self.g.nodes[mid].setdefault("tracked", False)
                self.edge(pid, mid, "MENTIONS", observed_at=post["posted_at"])

            for handle in re.split(r"[,\s]+", post["coauthor_handle"] or ""):
                handle = handle.strip("@").lower()
                if handle and handle != account["handle"].lower():
                    cid = account_node(post["platform"], handle)
                    self.node(cid, "account", "@" + handle, handle=handle, platform=post["platform"])
                    self.g.nodes[cid].setdefault("tracked", False)
                    self.edge(pid, cid, "COLLABORATED_WITH", observed_at=post["posted_at"])

            out.append((pid, post))
        return out

    def _entities(self, posts: list[tuple[str, dict]]) -> None:
        """Topics and named entities from the LLM extractions, after entity resolution."""
        surfaces: dict[str, Counter] = {t: Counter() for t in ("product", "organization", "person", "campaign")}
        for _, post in posts:
            for entity in self.extractions.get(post["post_url"], {}).get("entities", []):
                surfaces[entity["type"]][entity["name"]] += 1
                if entity.get("brand"):
                    surfaces["organization"][entity["brand"]] += 1
        resolved: dict[str, Resolution] = {t: resolve_names(c) for t, c in surfaces.items()}
        for type_, res in resolved.items():
            self.aliases.extend((surface, f"{type_}:{key}", method) for surface, key, method in res.aliases)

        accounts = {row["node"]: row for row in self.account_rows}
        account_list = list({row["node"]: row for row in self.account_rows}.values())

        def org_node(name: str) -> str | None:
            """Organizations that are really a tracked account resolve to that account's company."""
            match = match_account(name, account_list)
            if match:
                self.aliases.append((name, match["company_node"], "account-match"))
                return match["company_node"]
            key = resolved["organization"].key_for(name)
            if not key:
                return None
            return self.node(f"organization:{key}", "organization", resolved["organization"].display[key])

        for pid, post in posts:
            extraction = self.extractions.get(post["post_url"])
            if not extraction:
                continue
            when = post["posted_at"]
            own_account = account_node(post["platform"], self.corpus["accounts"][post["account_id"]]["handle"])
            own_company = accounts.get(own_account, {}).get("company_node")

            for topic in extraction.get("topics", []):
                topic = self.topic_map.get(topic, topic)
                key = normalize(topic)
                if key:
                    self.edge(pid, self.node(f"topic:{key}", "topic", topic), "ABOUT", observed_at=when)

            for entity in extraction.get("entities", []):
                type_ = entity["type"]
                if type_ == "organization":
                    nid = org_node(entity["name"])
                    if nid and nid != own_company:
                        self.edge(pid, nid, "MENTIONS", observed_at=when)
                    continue
                key = resolved[type_].key_for(entity["name"])
                if not key:
                    continue
                nid = self.node(f"{type_}:{key}", type_, resolved[type_].display[key])
                self.edge(pid, nid, "PART_OF" if type_ == "campaign" else "MENTIONS", observed_at=when)
                if type_ == "product":
                    maker = org_node(entity["brand"]) if entity.get("brand") else None
                    if maker:
                        self.edge(nid, maker, "MADE_BY")

    def _timestamps(self) -> None:
        """first_seen / last_seen on every node, from the posts it's connected to."""
        for nid, data in self.g.nodes(data=True):
            if data["type"] == "post":
                data["first_seen"] = data["last_seen"] = data["posted_at"]
                continue
            times = [
                attrs["observed_at"]
                for _, _, attrs in list(self.g.in_edges(nid, data=True)) + list(self.g.out_edges(nid, data=True))
                if attrs.get("observed_at")
            ]
            if times:
                data["first_seen"], data["last_seen"] = min(times), max(times)
