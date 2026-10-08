"""Build a stratified labeling queue from real posts, and label it by hand in the terminal.

Sampling is stratified on the production classifier's predicted category so rare classes
(paid_promotion, testimonial) get enough examples to measure. Because that oversamples
rare classes, every gold row carries its stratum, and the eval reweights by
(posts in stratum / labeled posts in stratum) to recover unbiased overall numbers.
"""

import csv
import random
import textwrap
from collections import Counter
from datetime import datetime, timezone

from ..config import DATA_DIR, load_classify_prompt
from ..db import load_corpus

QUEUE_PATH = DATA_DIR / "label_queue.csv"
GOLD_PATH = DATA_DIR / "gold_labels.csv"
GUIDE_PATH = DATA_DIR / "labeling_guide.md"
GOLD_FIELDS = ["post_id", "post_url", "stratum", "gold_label", "labeled_at"]
SKIP = "skip"


def unique_posts(corpus: dict) -> list[dict]:
    """One row per post URL. The same post is stored once per analysis it was scraped in."""
    seen: dict[str, dict] = {}
    for post in sorted(corpus["posts"], key=lambda p: p["id"]):
        if post["id"] in corpus["categories"]:
            seen.setdefault(post["post_url"], post)
    return list(seen.values())


def allocate(stratum_sizes: dict[str, int], total: int, min_per_class: int) -> dict[str, int]:
    """Proportional allocation with a floor per class, capped at what exists."""
    population = sum(stratum_sizes.values())
    return {
        stratum: min(size, max(min_per_class, round(total * size / population)))
        for stratum, size in stratum_sizes.items()
    }


def build_queue(total: int = 150, min_per_class: int = 20, seed: int = 7) -> None:
    corpus = load_corpus()
    posts = unique_posts(corpus)
    by_stratum: dict[str, list[dict]] = {}
    for post in posts:
        by_stratum.setdefault(corpus["categories"][post["id"]]["category"], []).append(post)

    quotas = allocate({s: len(p) for s, p in by_stratum.items()}, total, min_per_class)
    rng = random.Random(seed)
    queue = []
    for stratum, quota in sorted(quotas.items()):
        for post in rng.sample(by_stratum[stratum], quota):
            queue.append({"post_id": post["id"], "post_url": post["post_url"], "stratum": stratum})
    # Shuffled so stopping partway still leaves every stratum represented.
    rng.shuffle(queue)

    with QUEUE_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["post_id", "post_url", "stratum"])
        writer.writeheader()
        writer.writerows(queue)

    print(f"Wrote {len(queue)} posts to {QUEUE_PATH.relative_to(DATA_DIR.parent.parent)}")
    for stratum, quota in sorted(quotas.items()):
        print(f"  {stratum:<15} {quota:>3} of {len(by_stratum[stratum])}")


def read_gold() -> list[dict]:
    if not GOLD_PATH.exists():
        return []
    with GOLD_PATH.open() as f:
        return list(csv.DictReader(f))


def label_interactively() -> None:
    if not QUEUE_PATH.exists():
        raise SystemExit("No labeling queue yet. Run: python -m onvibe_ml label sample")

    categories = load_classify_prompt()["categories"]
    keys = {str(i + 1): c for i, c in enumerate(categories)}
    with QUEUE_PATH.open() as f:
        queue = list(csv.DictReader(f))
    done = {row["post_id"] for row in read_gold()}
    todo = [row for row in queue if row["post_id"] not in done]
    if not todo:
        print(f"All {len(queue)} queued posts are labeled.")
        return

    corpus = load_corpus()
    posts = {p["id"]: p for p in corpus["posts"]}
    accounts = corpus["accounts"]

    new_file = not GOLD_PATH.exists() or GOLD_PATH.stat().st_size == 0
    with GOLD_PATH.open("a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=GOLD_FIELDS)
        if new_file:
            writer.writeheader()

        menu = "  ".join(f"[{k}] {c}" for k, c in keys.items()) + "  [s] skip  [g] guide  [q] quit"
        for i, row in enumerate(todo, start=1):
            post = posts[row["post_id"]]
            account = accounts[post["account_id"]]
            # The model's prediction is deliberately not shown, so it can't anchor the label.
            print("\n" + "=" * 88)
            print(f"[{len(done) + i}/{len(queue)}]  @{account['handle']} on {post['platform']}  ·  {post['media_type']}")
            print(f"co-author tag: {post['coauthor_handle'] or 'none'}   {post['post_url']}")
            print("-" * 88)
            caption = post["caption"] or "(no caption)"
            print("\n".join(textwrap.fill(line, 88) for line in caption.splitlines()))
            print("-" * 88)
            while True:
                answer = input(menu + "\n> ").strip().lower()
                if answer == "q":
                    print(f"Saved. {len(done) + i - 1} of {len(queue)} labeled.")
                    return
                if answer == "g":
                    print(GUIDE_PATH.read_text())
                    continue
                if answer == "s" or answer in keys:
                    writer.writerow(
                        {
                            "post_id": row["post_id"],
                            "post_url": row["post_url"],
                            "stratum": row["stratum"],
                            "gold_label": SKIP if answer == "s" else keys[answer],
                            "labeled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        }
                    )
                    f.flush()
                    break
    print("Queue complete.")


def gold_summary() -> Counter:
    return Counter(row["gold_label"] for row in read_gold())
