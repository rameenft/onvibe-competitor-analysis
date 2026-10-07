from functools import lru_cache

from supabase import Client, create_client

from .config import supabase_config

PAGE_SIZE = 1000  # PostgREST's default max rows per request


@lru_cache(maxsize=1)
def client() -> Client:
    url, key = supabase_config()
    return create_client(url, key)


def fetch_all(table: str, columns: str = "*", **eq_filters) -> list[dict]:
    """Select every row (paging past PostgREST's 1000-row cap), with optional equality filters."""
    rows: list[dict] = []
    start = 0
    while True:
        query = client().table(table).select(columns)
        for column, value in eq_filters.items():
            query = query.eq(column, value)
        page = query.range(start, start + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def load_corpus() -> dict:
    """Everything the evals and graph builder read, in one pass."""
    analyses = {a["id"]: a for a in fetch_all("analyses")}
    accounts = {a["id"]: a for a in fetch_all("accounts")}
    posts = fetch_all(
        "posts",
        "id, account_id, platform, post_url, caption, media_type, likes, comments, shares, views, posted_at, coauthor_handle",
    )
    categories = {c["post_id"]: c for c in fetch_all("post_categories", "post_id, category, confidence, rationale")}
    return {"analyses": analyses, "accounts": accounts, "posts": posts, "categories": categories}
