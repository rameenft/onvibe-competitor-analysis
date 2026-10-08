import json
from collections import Counter

import pytest

from onvibe_ml.kg import extract
from onvibe_ml.kg.graph import GraphBuilder, account_node, post_node
from onvibe_ml.kg.queries import topic_gap_data, topic_gaps
from onvibe_ml.kg.resolve import canonicalize_topics, match_account, normalize, resolve_names
from onvibe_ml.llm import Usage


def test_normalize_strips_handles_and_corporate_suffixes():
    assert normalize("@Predis.ai") == "predis"
    assert normalize("Wondershare Inc.") == "wondershare"
    assert normalize("#NASA_Webb") == "nasa webb"


def test_resolve_names_merges_variants_and_keeps_most_common_display():
    res = resolve_names(Counter({"Dr.Fone": 5, "Dr. Fone": 2, "drfone": 1, "MobileTrans": 3}))
    assert res.key_for("Dr. Fone") == res.key_for("Dr.Fone")
    assert res.display[res.key_for("dr. fone")] == "Dr.Fone"
    assert res.key_for("MobileTrans") != res.key_for("Dr.Fone")
    assert {a for a, _, _ in res.aliases} >= {"Dr. Fone"}


ACCOUNTS = [
    {"handle": "wondershare_dr.fone", "display_name": "Wondershare Dr.Fone", "company": "Wondershare Dr.Fone"},
    {"handle": "wondershare", "display_name": "Wondershare", "company": "Wondershare"},
    {"handle": "stanforcreators", "display_name": "Stan — Your All-in-One Creator Store", "company": "Stan"},
    {"handle": "natgeo", "display_name": "National Geographic", "company": "National Geographic"},
]


def test_match_account_prefers_exact_over_prefix():
    # "Wondershare" must not prefix-match @wondershare_dr.fone just because it's listed first.
    assert match_account("Wondershare", ACCOUNTS)["handle"] == "wondershare"
    assert match_account("Dr.Fone by Wondershare", ACCOUNTS) is None
    assert match_account("Wondershare Dr.Fone", ACCOUNTS)["handle"] == "wondershare_dr.fone"


def test_match_account_prefix_has_a_minimum_length():
    assert match_account("Stan", ACCOUNTS)["handle"] == "stanforcreators"
    assert match_account("Nat", ACCOUNTS) is None


def test_extraction_guardrail_drops_entities_not_in_caption():
    caption = "Back up every photo with Dr. Fone — our partners at Google Photos agree!"
    assert extract.is_grounded({"name": "Dr.Fone", "evidence": "Back up every photo with Dr. Fone"}, caption)
    assert not extract.is_grounded({"name": "iCloud", "evidence": "sync with iCloud"}, caption)
    # Real quote, but the name isn't in it.
    assert not extract.is_grounded({"name": "Dropbox", "evidence": "our partners at Google Photos"}, caption)


def test_extract_end_to_end_with_fake_model(monkeypatch, tmp_path):
    monkeypatch.setattr(extract, "CACHE_DIR", tmp_path)

    def fake_call_tool(model, system, tool, content, usage, max_tokens=16000):
        assert "posting_account: @acme" in content
        return {
            "posts": [
                {
                    "post_ref": "p1",
                    "topics": ["Photo Backup "],
                    "entities": [
                        {"type": "product", "name": "Dr.Fone", "brand": "Wondershare", "evidence": "Try Dr. Fone"},
                        {"type": "organization", "name": "Apple", "evidence": "loved by Apple"},  # hallucinated
                    ],
                }
            ]
        }

    monkeypatch.setattr(extract, "call_tool", fake_call_tool)
    posts = [{"post_url": "u1", "account_id": "a1", "caption": "Try Dr. Fone today #backup"}]
    results, _, stats = extract.extract(posts, {"a1": "acme"}, model="fake")
    assert results["u1"]["topics"] == ["photo backup"]
    assert [e["name"] for e in results["u1"]["entities"]] == ["Dr.Fone"]
    assert stats == {"kept": 1, "dropped": 1, "dropped_examples": [results["u1"]["dropped"][0]]}
    # Second run is served from cache: the fake would fail the assert if called with other content.
    monkeypatch.setattr(extract, "call_tool", lambda *a, **k: (_ for _ in ()).throw(AssertionError("called")))
    again, usage, _ = extract.extract(posts, {"a1": "acme"}, model="fake")
    assert again["u1"]["entities"] == results["u1"]["entities"] and usage.calls == 0


def test_canonicalize_topics_can_only_merge_existing_labels(monkeypatch, tmp_path):
    from onvibe_ml.kg import resolve

    monkeypatch.setattr(resolve, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        resolve,
        "call_tool",
        lambda *a, **k: {
            "groups": [
                {"canonical": "phone cleanup", "members": ["phone cleanup", "phone storage cleanup"]},
                {"canonical": "invented label", "members": ["rocket launch", "mars"]},  # not an input label
            ]
        },
    )
    mapping = canonicalize_topics(Counter({"phone cleanup": 3, "phone storage cleanup": 1, "rocket launch": 2}), "m", Usage())
    assert mapping == {"phone cleanup": "phone cleanup", "phone storage cleanup": "phone cleanup"}


def _corpus():
    analyses = {"an1": {"id": "an1", "company_name": "Acme", "created_at": "2026-07-01T00:00:00Z"}}
    accounts = {
        "t": {"id": "t", "analysis_id": "an1", "platform": "instagram", "handle": "acme.app", "role": "target",
              "display_name": "Acme", "followers": 500, "scraped_at": "2026-07-01"},
        "c": {"id": "c", "analysis_id": "an1", "platform": "instagram", "handle": "rivalco", "role": "competitor",
              "display_name": "RivalCo — Best Rival", "followers": 9000, "scraped_at": "2026-07-01"},
    }

    def post(pid, account, caption, likes, url=None, coauthor=None):
        return {"id": pid, "account_id": account, "platform": "instagram", "post_url": url or f"https://x/{pid}",
                "caption": caption, "media_type": "image", "likes": likes, "comments": 0, "shares": None,
                "views": None, "posted_at": f"2026-06-0{pid[-1]}T00:00:00Z", "coauthor_handle": coauthor}

    posts = [
        post("p1", "t", "Our app now does photo backup #Backup", 10),
        post("p2", "t", "Meet the team @rivalco.", 10),
        post("p3", "c", "Phone cleanup tips with RivalCo Cleaner, featuring Acme", 100),
        post("p4", "c", "More phone cleanup tips", 300, coauthor="creator_x"),
        post("p5", "c", "Even more phone cleanup", 200),
        post("p6", "c", "Duplicate of p5 from another analysis", 200, url="https://x/p5"),
    ]
    categories = {p["id"]: {"post_id": p["id"], "category": "educational"} for p in posts}
    return {"analyses": analyses, "accounts": accounts, "posts": posts, "categories": categories}


EXTRACTIONS = {
    "https://x/p1": {"topics": ["photo backup"], "entities": []},
    "https://x/p3": {
        "topics": ["phone cleanup"],
        "entities": [
            {"type": "product", "name": "RivalCo Cleaner", "brand": "RivalCo", "evidence": "with RivalCo Cleaner"},
            {"type": "organization", "name": "Acme", "evidence": "featuring Acme"},
        ],
    },
    "https://x/p4": {"topics": ["phone cleanup"], "entities": []},
    "https://x/p5": {"topics": ["phone cleanup"], "entities": []},
}


def test_graph_builder_end_to_end():
    builder = GraphBuilder(_corpus(), EXTRACTIONS)
    g = builder.build()
    target = account_node("instagram", "acme.app")
    rival = account_node("instagram", "rivalco")

    # Duplicate post URL collapses to one node; rival has 3 unique posts.
    assert sum(1 for _, _, k in g.out_edges(rival, keys=True) if k == "POSTED") == 3
    assert g.has_edge(target, rival, "COMPETES_WITH:an1")
    # Trailing dot dropped from the mention; co-author becomes an untracked account.
    assert g.has_edge(post_node("https://x/p2"), rival, "MENTIONS")
    assert g.nodes[account_node("instagram", "creator_x")]["tracked"] is False
    # Lift is relative to the account's own median (200 for the rival).
    assert g.nodes[post_node("https://x/p4")]["lift"] == 1.5
    # "Acme" in a rival's caption resolves to the target's company node; the product's brand
    # "RivalCo" resolves to the rival's company ("RivalCo — Best Rival" -> "RivalCo").
    assert g.has_edge(post_node("https://x/p3"), "company:acme", "MENTIONS")
    assert g.has_edge("product:rivalco cleaner", "company:rivalco", "MADE_BY")
    assert ("Acme", "company:acme", "account-match") in builder.aliases
    assert g.nodes["topic:phone cleanup"]["first_seen"] == "2026-06-03T00:00:00Z"


def test_topic_gaps_finds_competitor_only_topics():
    g = GraphBuilder(_corpus(), EXTRACTIONS).build()
    report = topic_gaps(g, "an1", min_posts=3)
    gaps_section, owned_section = report.split("Topics only the target covers:")
    assert "phone cleanup" in gaps_section and "@rivalco" in gaps_section
    assert "photo backup" in owned_section


def test_topic_gap_data_matches_the_ts_shape_and_handles_several_targets():
    g = GraphBuilder(_corpus(), EXTRACTIONS).build()
    data = topic_gap_data(g, "an1", min_posts=3)
    assert data["targets"] == ["@acme.app"] and data["competitors"] == ["@rivalco"]
    assert data["gaps"] == [{"topic": "phone cleanup", "medianLift": 1.0, "postCount": 3, "accounts": ["@rivalco"]}]
    assert [t["topic"] for t in data["targetOnlyTopics"]] == ["photo backup"]
    assert data["competitorPostCount"] == 3
    assert topic_gap_data(g, "nope") is None

    # A target that covers a topic on either platform closes the gap.
    g.add_node("account:tiktok:acme.app", type="account", name="@acme.app")
    g.add_edge("account:tiktok:acme.app", account_node("instagram", "rivalco"), key="COMPETES_WITH:an1", type="COMPETES_WITH", analysis_id="an1")
    assert len(topic_gap_data(g, "an1")["targets"]) == 2


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.filters = db, table, "select", []

    def select(self, *_):
        return self

    def delete(self):
        self.op = "delete"
        return self

    def upsert(self, rows, on_conflict=None):
        self.db.log.append(("upsert", self.table, len(rows), on_conflict))
        self.op = "upsert"
        return self

    def in_(self, column, values):
        self.filters.append((column, "in", list(values)))
        return self

    def eq(self, column, value):
        self.filters.append((column, "eq", value))
        return self

    def limit(self, _):
        return self

    def execute(self):
        if self.op == "delete":
            self.db.log.append(("delete", self.table, self.filters))
        data = self.db.existing.get(self.table, []) if self.op == "select" else []
        return type("R", (), {"data": data})


class FakeDb:
    def __init__(self, existing=None):
        self.log, self.existing = [], existing or {}

    def table(self, name):
        return FakeQuery(self, name)


def test_save_supabase_analysis_upserts_without_wiping_and_widens_seen_range(monkeypatch):
    from onvibe_ml.kg import store

    g = GraphBuilder(_corpus(), EXTRACTIONS).build()
    captured = []
    db = FakeDb({"kg_nodes": [{"id": "topic:phone cleanup", "first_seen": "2026-01-01T00:00:00+00:00", "last_seen": "2026-01-02T00:00:00+00:00"}]})
    monkeypatch.setattr(store, "client", lambda: db)
    orig = store._merge_seen
    monkeypatch.setattr(store, "_merge_seen", lambda d, nodes: (orig(d, nodes), captured.extend(nodes)))

    posts = [n for n, d in g.nodes(data=True) if d["type"] == "post"]
    store.save_supabase_analysis(g, [], "an1", posts)

    deletes = [e for e in db.log if e[0] == "delete"]
    # Only edges from this analysis' posts / its own COMPETES_WITH are deleted; never a table-wide wipe.
    assert all(any(f[0] in ("src", "dst", "analysis_id") for f in e[2]) for e in deletes)
    assert ("analysis_id", "eq", "an1") in deletes[-1][2]
    assert not any(e[1] == "kg_nodes" for e in deletes)
    # Upserts keyed on the deterministic ids; nodes go in before edges (FK order).
    upserts = [e for e in db.log if e[0] == "upsert"]
    assert [u[1] for u in upserts][:1] == ["kg_nodes"] and ("upsert", "kg_edges", g.number_of_edges(), "id") in upserts
    # The topic's first_seen stays at the earlier stored date; last_seen moves to the new post.
    topic = next(n for n in captured if n["id"] == "topic:phone cleanup")
    assert topic["first_seen"] == "2026-01-01T00:00:00+00:00"
    assert topic["last_seen"] == "2026-06-05T00:00:00Z"


def test_build_analysis_json_mode_keeps_stdout_clean_and_writes_no_local_graph(monkeypatch, capsys, tmp_path):
    from onvibe_ml.kg import cli, store

    monkeypatch.setattr(cli, "load_analysis_corpus", lambda _id: _corpus())
    monkeypatch.setattr(cli.extract, "extract", lambda posts, handle_of, model: (EXTRACTIONS, Usage(), {}))
    monkeypatch.setattr(cli, "canonicalize_topics", lambda *a: {})
    monkeypatch.setattr(store, "GRAPH_PATH", tmp_path / "graph.json")
    monkeypatch.setattr(cli, "REPORTS_DIR", tmp_path)
    persisted = []
    monkeypatch.setattr(store, "save_supabase_analysis", lambda g, aliases, aid, posts: (print("noise"), persisted.append((aid, len(posts)))))

    cli.build_analysis("an1", "fake", persist=True, as_json=True)
    out, err = capsys.readouterr()
    assert json.loads(out)["gaps"][0]["topic"] == "phone cleanup"  # stdout is JSON and nothing else
    assert "noise" in err and persisted == [("an1", 6 - 1)]
    assert list(tmp_path.iterdir()) == []  # no local graph.json, no kg_summary.md


def test_build_analysis_rejects_an_analysis_with_no_competitors(monkeypatch):
    from onvibe_ml.kg import cli

    corpus = _corpus()
    corpus["accounts"].pop("c")
    corpus["posts"] = [p for p in corpus["posts"] if p["account_id"] == "t"]
    monkeypatch.setattr(cli, "load_analysis_corpus", lambda _id: corpus)
    monkeypatch.setattr(cli.extract, "extract", lambda posts, handle_of, model: ({}, Usage(), {}))
    with pytest.raises(SystemExit, match="nothing to compare"):
        cli.build_analysis("an1", "fake", persist=False, as_json=True)
