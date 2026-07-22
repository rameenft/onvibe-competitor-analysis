import json

from pipeline.config import CLAUDE_MODEL, get_anthropic_client, get_supabase_client

anthropic = get_anthropic_client()
supabase = get_supabase_client()

CATEGORIES = [
    "collaboration",   # tagged co-author (creator, employee-advocacy, or institutional partner)
    "campaign",        # coordinated promo push, giveaway, launch, seasonal push
    "paid_promotion",  # explicit "Paid partnership" / "#ad" / sponsorship language
    "product",         # straightforward product/feature content
    "testimonial",     # customer story, review, social proof
    "educational",     # how-to, tips, thought leadership
    "other",
]

CLASSIFY_TOOL = {
    "name": "classify_posts",
    "description": "Classify each Instagram post into exactly one content category.",
    "input_schema": {
        "type": "object",
        "properties": {
            "classifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "post_id": {"type": "string"},
                        "category": {"type": "string", "enum": CATEGORIES},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "rationale": {"type": "string"},
                    },
                    "required": ["post_id", "category", "confidence", "rationale"],
                },
            },
        },
        "required": ["classifications"],
    },
}

SYSTEM_PROMPT = """You are classifying Instagram posts for a competitive analysis report.
A tagged co-author alone does not automatically mean paid influencer marketing — read the
caption for signals of employee advocacy, institutional partnership, or genuine collaboration
before defaulting to "collaboration" vs "paid_promotion". Only use "paid_promotion" when the
caption or a coauthor tag clearly signals sponsorship (e.g. "Paid partnership", "#ad", explicit
sponsorship language). Keep rationale to one sentence."""


def classify_posts_for_account(account_id: str) -> None:
    posts = supabase.table("posts").select("id, caption, coauthor_handle").eq("account_id", account_id).execute().data
    if not posts:
        return

    post_lines = [
        f"post_id: {p['id']}\ncoauthor_tag: {p['coauthor_handle'] or 'none'}\ncaption: {p['caption'] or '(no caption)'}"
        for p in posts
    ]
    message = anthropic.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        tools=[CLASSIFY_TOOL],
        tool_choice={"type": "tool", "name": "classify_posts"},
        messages=[{"role": "user", "content": "\n\n---\n\n".join(post_lines)}],
    )

    tool_call = next(block for block in message.content if block.type == "tool_use")
    classifications = tool_call.input["classifications"]

    rows = [{
        "post_id": c["post_id"],
        "category": c["category"],
        "confidence": c["confidence"],
        "rationale": c["rationale"],
    } for c in classifications]
    supabase.table("post_categories").upsert(rows, on_conflict="post_id").execute()


def classify_all(account_ids: dict[str, str]) -> None:
    for account_id in account_ids.values():
        classify_posts_for_account(account_id)
