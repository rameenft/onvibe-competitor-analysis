from pipeline.config import LOOKBACK_DAYS, get_supabase_client

supabase = get_supabase_client()

GROWTH_UNAVAILABLE_NOTE = (
    "Follower growth requires two snapshots taken 30 days apart. This report is a single "
    "point-in-time run, so growth is not measurable yet — treat as a data gap, not a zero."
)


def compute_account_metrics(account: dict) -> dict:
    posts = supabase.table("posts").select("likes, comments").eq("account_id", account["id"]).execute().data
    followers = account.get("followers") or 0
    post_count = len(posts)

    avg_likes = sum(p["likes"] for p in posts) / post_count if post_count else 0
    avg_comments = sum(p["comments"] for p in posts) / post_count if post_count else 0
    engagement_rate = (avg_likes + avg_comments) / followers if followers else 0
    likes_rate = avg_likes / followers if followers else 0
    comments_rate = avg_comments / followers if followers else 0
    posts_per_week = post_count / (LOOKBACK_DAYS / 7)

    return {
        "handle": account["handle"],
        "role": account["role"],
        "followers": followers,
        "post_count_30d": post_count,
        "avg_likes": round(avg_likes, 2),
        "avg_comments": round(avg_comments, 2),
        "engagement_rate": round(engagement_rate, 4),
        "likes_rate": round(likes_rate, 4),
        "comments_rate": round(comments_rate, 4),
        "posts_per_week": round(posts_per_week, 2),
        "growth_rate": None,
        "growth_rate_note": GROWTH_UNAVAILABLE_NOTE,
    }


def _percentile_rank(value: float, all_values: list[float]) -> int:
    if not all_values:
        return 0
    below_or_equal = sum(1 for v in all_values if v <= value)
    return round(100 * below_or_equal / len(all_values))


def attach_percentiles(all_metrics: list[dict]) -> list[dict]:
    fields = ["engagement_rate", "likes_rate", "comments_rate", "followers", "avg_likes"]
    for field in fields:
        values = [m[field] for m in all_metrics]
        for m in all_metrics:
            m[f"{field}_percentile"] = _percentile_rank(m[field], values)
    return all_metrics


def compute_category_performance(account_id: str) -> dict:
    rows = (
        supabase.table("posts")
        .select("likes, comments, post_categories(category)")
        .eq("account_id", account_id)
        .execute()
        .data
    )
    if not rows:
        return {}

    baseline = sum(r["likes"] + r["comments"] for r in rows) / len(rows)

    by_category: dict[str, list[float]] = {}
    for r in rows:
        cat = (r.get("post_categories") or {}).get("category", "other")
        by_category.setdefault(cat, []).append(r["likes"] + r["comments"])

    return {
        "baseline_engagement": round(baseline, 2),
        "categories": {
            cat: {
                "post_count": len(values),
                "avg_engagement": round(sum(values) / len(values), 2),
                "vs_baseline_multiplier": round((sum(values) / len(values)) / baseline, 2) if baseline else None,
            }
            for cat, values in by_category.items()
        },
    }


def compute_all(accounts: list[dict]) -> dict:
    account_metrics = [compute_account_metrics(a) for a in accounts]
    account_metrics = attach_percentiles(account_metrics)
    category_metrics = {a["handle"]: compute_category_performance(a["id"]) for a in accounts}
    return {"accounts": account_metrics, "categories": category_metrics}
