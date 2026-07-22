from datetime import datetime, timedelta, timezone

from pipeline.config import (
    APIFY_POST_ACTOR_ID,
    APIFY_PROFILE_ACTOR_ID,
    LOOKBACK_DAYS,
    get_apify_client,
    get_supabase_client,
)

apify = get_apify_client()
supabase = get_supabase_client()


def create_analysis(company_name: str, industry: str, region: str) -> str:
    result = supabase.table("analyses").insert({
        "company_name": company_name,
        "industry": industry,
        "region": region,
        "status": "scraping",
    }).execute()
    return result.data[0]["id"]


def register_accounts(analysis_id: str, target_handle: str, competitor_handles: list[str]) -> dict[str, str]:
    rows = [{"analysis_id": analysis_id, "handle": target_handle, "role": "target"}]
    rows += [{"analysis_id": analysis_id, "handle": h, "role": "competitor"} for h in competitor_handles]
    result = supabase.table("accounts").insert(rows).execute()
    return {row["handle"]: row["id"] for row in result.data}


def scrape_profile(handle: str) -> dict:
    run = apify.actor(APIFY_PROFILE_ACTOR_ID).call(run_input={"usernames": [handle]})
    items = list(apify.dataset(run["defaultDatasetId"]).iterate_items())
    return items[0] if items else {}


def scrape_recent_posts(handle: str) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    run = apify.actor(APIFY_POST_ACTOR_ID).call(run_input={
        "username": [handle],
        "onlyPostsNewerThan": cutoff.strftime("%Y-%m-%d"),
    })
    items = list(apify.dataset(run["defaultDatasetId"]).iterate_items())
    return [item for item in items if _posted_at(item) >= cutoff]


def _posted_at(item: dict) -> datetime:
    raw = item.get("timestamp") or item.get("takenAt")
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))


def store_profile(account_id: str, profile: dict) -> None:
    supabase.table("accounts").update({
        "followers": profile.get("followersCount"),
        "following": profile.get("followsCount"),
        "bio": profile.get("biography"),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", account_id).execute()


def store_posts(account_id: str, posts: list[dict]) -> None:
    rows = [{
        "account_id": account_id,
        "post_url": post.get("url"),
        "caption": post.get("caption"),
        "media_type": post.get("type"),
        "likes": post.get("likesCount", 0),
        "comments": post.get("commentsCount", 0),
        "posted_at": _posted_at(post).isoformat(),
        "coauthor_handle": _first_coauthor(post),
    } for post in posts]
    if rows:
        supabase.table("posts").upsert(rows, on_conflict="account_id,post_url").execute()


def _first_coauthor(post: dict) -> str | None:
    coauthors = post.get("coauthorProducers") or []
    return coauthors[0].get("username") if coauthors else None


def run_scrape(analysis_id: str, account_ids: dict[str, str]) -> None:
    for handle, account_id in account_ids.items():
        profile = scrape_profile(handle)
        store_profile(account_id, profile)
        posts = scrape_recent_posts(handle)
        store_posts(account_id, posts)
