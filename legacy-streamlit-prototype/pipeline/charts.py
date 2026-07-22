import matplotlib
import matplotlib.pyplot as plt

matplotlib.use("Agg")

SURFACE = "#fcfcfb"
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRIDLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
TARGET_COLOR = "#2a78d6"
COMPETITOR_COLOR = "#898781"

CATEGORY_COLORS = {
    "collaboration": "#2a78d6",
    "campaign": "#1baf7a",
    "paid_promotion": "#eda100",
    "product": "#4a3aa7",
    "testimonial": "#e34948",
    "educational": "#e87ba4",
    "other": "#898781",
}


def _style_axes(ax):
    ax.set_facecolor(SURFACE)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    for spine in ("left", "bottom"):
        ax.spines[spine].set_color(BASELINE)
    ax.tick_params(colors=INK_MUTED, labelsize=9)
    ax.grid(True, color=GRIDLINE, linewidth=0.6)
    ax.set_axisbelow(True)


def chart_followers_vs_engagement(accounts: list[dict], out_path: str) -> str:
    fig, ax = plt.subplots(figsize=(7, 5), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    _style_axes(ax)

    followers = [a["followers"] or 1 for a in accounts]
    er = [a["engagement_rate"] * 100 for a in accounts]
    median_followers = sorted(followers)[len(followers) // 2]
    median_er = sorted(er)[len(er) // 2]

    for a, f, e in zip(accounts, followers, er):
        is_target = a["role"] == "target"
        color = TARGET_COLOR if is_target else COMPETITOR_COLOR
        ax.scatter(f, e, s=90 if is_target else 60, color=color, zorder=3,
                   edgecolors="white", linewidths=0.8)
        ax.annotate(a["handle"], (f, e), textcoords="offset points", xytext=(6, 4),
                    fontsize=8, color=INK_PRIMARY if is_target else INK_SECONDARY,
                    fontweight="bold" if is_target else "normal")

    ax.axvline(median_followers, color=BASELINE, linestyle="--", linewidth=1)
    ax.axhline(median_er, color=BASELINE, linestyle="--", linewidth=1)
    ax.set_xscale("log")
    ax.set_xlabel("Followers (log scale)", color=INK_SECONDARY)
    ax.set_ylabel("Engagement rate (%)", color=INK_SECONDARY)
    ax.set_title("Followers vs Engagement Rate", color=INK_PRIMARY, fontsize=12, loc="left")

    fig.tight_layout()
    fig.savefig(out_path, facecolor=SURFACE)
    plt.close(fig)
    return out_path


def chart_volume_vs_quality(accounts: list[dict], out_path: str) -> str:
    fig, ax = plt.subplots(figsize=(7, 5), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    _style_axes(ax)

    volume = [a["posts_per_week"] for a in accounts]
    quality = [a["avg_likes"] for a in accounts]
    median_volume = sorted(volume)[len(volume) // 2]
    median_quality = sorted(quality)[len(quality) // 2]

    for a, v, q in zip(accounts, volume, quality):
        is_target = a["role"] == "target"
        color = TARGET_COLOR if is_target else COMPETITOR_COLOR
        ax.scatter(v, q, s=90 if is_target else 60, color=color, zorder=3,
                   edgecolors="white", linewidths=0.8)
        ax.annotate(a["handle"], (v, q), textcoords="offset points", xytext=(6, 4),
                    fontsize=8, color=INK_PRIMARY if is_target else INK_SECONDARY,
                    fontweight="bold" if is_target else "normal")

    ax.axvline(median_volume, color=BASELINE, linestyle="--", linewidth=1)
    ax.axhline(median_quality, color=BASELINE, linestyle="--", linewidth=1)
    ax.set_xlabel("Posts / week (last 30 days)", color=INK_SECONDARY)
    ax.set_ylabel("Avg likes per post", color=INK_SECONDARY)
    ax.set_title("Content Volume vs Quality", color=INK_PRIMARY, fontsize=12, loc="left")

    fig.tight_layout()
    fig.savefig(out_path, facecolor=SURFACE)
    plt.close(fig)
    return out_path


def chart_category_performance(category_metrics: dict[str, dict], out_path: str) -> str:
    handles = list(category_metrics.keys())
    fig, ax = plt.subplots(figsize=(7, max(3, 0.9 * len(handles))), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    _style_axes(ax)

    seen_categories = set()
    for i, handle in enumerate(handles):
        data = category_metrics[handle]
        baseline = data.get("baseline_engagement")
        if baseline is None:
            continue
        ax.plot([baseline, baseline], [i - 0.3, i + 0.3], color=BASELINE, linewidth=2, zorder=2)
        for category, stats in data.get("categories", {}).items():
            color = CATEGORY_COLORS.get(category, "#898781")
            ax.scatter(stats["avg_engagement"], i, s=70, color=color, zorder=3,
                       edgecolors="white", linewidths=0.8,
                       label=category if category not in seen_categories else None)
            seen_categories.add(category)

    ax.set_yticks(range(len(handles)))
    ax.set_yticklabels(handles, color=INK_PRIMARY, fontsize=9)
    ax.set_xscale("log")
    ax.set_xlabel("Avg engagement per post, likes + comments (log scale)", color=INK_SECONDARY)
    ax.set_title("Content Category Performance vs Organic Baseline", color=INK_PRIMARY, fontsize=12, loc="left")
    ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1), fontsize=8, frameon=False)

    fig.tight_layout()
    fig.savefig(out_path, facecolor=SURFACE, bbox_inches="tight")
    plt.close(fig)
    return out_path


def generate_all_charts(metrics: dict, output_dir: str) -> dict[str, str]:
    accounts = metrics["accounts"]
    return {
        "followers_vs_engagement": chart_followers_vs_engagement(accounts, f"{output_dir}/chart1_followers_vs_engagement.png"),
        "volume_vs_quality": chart_volume_vs_quality(accounts, f"{output_dir}/chart2_volume_vs_quality.png"),
        "category_performance": chart_category_performance(metrics["categories"], f"{output_dir}/chart3_category_performance.png"),
    }
