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


IN_CHUNK = 100  # ids per `in` filter, to keep the request URL short

POST_COLUMNS = "id, account_id, platform, post_url, caption, media_type, likes, comments, shares, views, posted_at, coauthor_handle"
CATEGORY_COLUMNS = "post_id, category, confidence, rationale"


def load_corpus() -> dict:
    """Everything the evals and graph builder read, in one pass."""
    analyses = {a["id"]: a for a in fetch_all("analyses")}
    accounts = {a["id"]: a for a in fetch_all("accounts")}
    posts = fetch_all("posts", POST_COLUMNS)
    categories = {c["post_id"]: c for c in fetch_all("post_categories", CATEGORY_COLUMNS)}
    return {"analyses": analyses, "accounts": accounts, "posts": posts, "categories": categories}


def load_analysis_corpus(analysis_id: str) -> dict:
    """The same shape as load_corpus(), restricted to one analysis' accounts and their posts."""
    analyses = {a["id"]: a for a in fetch_all("analyses", id=analysis_id)}
    if not analyses:
        raise LookupError(f"No analysis {analysis_id}")
    accounts = {a["id"]: a for a in fetch_all("accounts", analysis_id=analysis_id)}
    posts = [p for account_id in accounts for p in fetch_all("posts", POST_COLUMNS, account_id=account_id)]
    categories: dict[str, dict] = {}
    post_ids = [p["id"] for p in posts]
    for i in range(0, len(post_ids), IN_CHUNK):
        rows = client().table("post_categories").select(CATEGORY_COLUMNS).in_("post_id", post_ids[i : i + IN_CHUNK]).execute().data
        categories.update({c["post_id"]: c for c in rows})
    return {"analyses": analyses, "accounts": accounts, "posts": posts, "categories": categories}
