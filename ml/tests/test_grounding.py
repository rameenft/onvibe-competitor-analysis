from onvibe_ml.evals.grounding import Evidence, check_claim, parse_numbers

METRICS = {
    "platform": "instagram",
    "accounts": [
        {
            "handle": "onvibe.co",
            "role": "target",
            "accountId": "44b1ba8a-21b2-4b01-8841-448c4bc310c1",
            "followers": 427,
            "engagementRate": 0.0126,
            "postsPerWeek": 3.66,
            "postCount": 47,
            "followersPercentile": 25,
            "categoryBreakdown": {"collaboration": {"postCount": 4, "avgEngagement": 38.75, "vsBaselineMultiplier": 7.2}},
            "baselineEngagement": 5.38,
            "weeklyGrowth": [{"weekStart": "2026-07-20", "followers": 427}],
        },
        {
            "handle": "stanforcreators",
            "role": "competitor",
            "accountId": "7f096e71-0f18-4f48-bfed-5c69c1a1b5b8",
            "followers": 247955,
            "engagementRate": 0.0072,
            "postsPerWeek": 4.74,
            "postCount": 61,
            "followersPercentile": 100,
            "avgLikes": 1618.34,
        },
    ],
}


def statuses(claim: str) -> list[str]:
    return [c.status for c in check_claim(claim, Evidence([METRICS], "OnVibe"))]


def test_parses_separators_suffixes_and_time_spans():
    parsed = {c.text.strip(): is_time for c, is_time in parse_numbers("247,955 followers, 1.26% rate, 7.2x lift, 30-day plan")}
    assert set(parsed) == {"247,955", "1.26%", "7.2x", "30"}
    assert parsed["30"] is True and parsed["247,955"] is False


def test_iso_dates_are_not_numbers():
    assert parse_numbers("only one snapshot (2026-07-27)") == []


def test_grounded_with_rounding_and_unit_conversion():
    # 0.0126 shown as a percentage, 247,955 shown as 248K, 7.2x multiplier as stored.
    assert statuses("OnVibe's engagement rate is 1.26% vs stanforcreators' 248K followers") == ["grounded", "grounded"]
    assert statuses("onvibe.co collaboration posts lift engagement 7.2x") == ["grounded"]


def test_ratio_is_derived():
    # 38.75 / 5.38 = 7.20..., but also check a ratio not stored anywhere: 4.74 / 3.66 = 1.295...
    assert statuses("stanforcreators posts 1.3x as often as onvibe.co") == ["derived"]


def test_fabricated_number_is_ungrounded():
    assert statuses("OnVibe has 9,999 followers") == ["ungrounded"]


def test_field_hint_rejects_number_from_wrong_metric():
    # 47 exists (postCount) but not as a percentile.
    assert statuses("OnVibe sits at the 47th percentile for followers") == ["ungrounded"]
    assert statuses("OnVibe sits at the 25th percentile for followers") == ["grounded"]


def test_posts_per_week_is_a_rate_not_a_count():
    assert statuses("onvibe.co posts 3.66 posts/week") == ["grounded"]
    assert statuses("onvibe.co posts 3.66x/week") == ["grounded"]


def test_misattribution_only_on_single_account_non_comparisons():
    # 247,955 is stanforcreators' follower count, attributed to OnVibe.
    assert statuses("OnVibe has 247,955 followers") == ["misattributed"]
    # A comparison may cite the other side's number without naming it.
    assert statuses("OnVibe has 427 followers vs the top competitor's 247,955") == ["grounded", "grounded"]


def test_small_counts_are_unverifiable_not_ungrounded():
    assert statuses("OnVibe trails all 3 competitors") == ["unverifiable"]
