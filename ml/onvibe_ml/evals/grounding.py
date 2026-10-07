"""Grounding check for synthesized insights: does every number the LLM cites exist in the data it was given?

The synthesis prompt requires every observation to "cite a specific metric". This checks
that mechanically. Each number in a claim is matched against the metrics JSON, allowing for
display rounding, % vs fraction (1.26% == 0.0126), K/M suffixes, and "Nx" ratios between two
values of the same account or the same metric. A claim that names an account but cites a
number found only under a different account is flagged as possibly misattributed.

Recommendations and 30/60/90 plans are skipped: their numbers are targets, not claims about data.
"""

import re
from dataclasses import dataclass, field
from itertools import permutations

from ..config import REPORTS_DIR
from ..db import fetch_all

NUMBER_RE = re.compile(
    r"(?<![\w.])(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?P<suffix>\s?%|x\b|×|[kKmM]\b|th\b|st\b|nd\b|rd\b)?"
    r"(?![\w])"
)
ISO_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
# "5.29x/week" means a rate (times per week), not a ratio.
RATE_AFTER_RE = re.compile(r"^\s*(/|per\b)")
# A claim that compares accounts can cite the other side's numbers without naming it
# ("you post 2.8/week vs the top competitor's 5.29"), so attribution is only checked
# on claims that name exactly one account and make no comparison.
COMPARISON_RE = re.compile(
    r"\b(vs\.?|versus|than|compared|while|whereas|your|you|competitors?|others?|rivals?|peers?|category)\b", re.I
)
TIME_AFTER_RE = re.compile(r"^[\s-]*(day|days|week|weeks|wk|month|months|hour|hours|minute|minutes|year|years)\b", re.I)
SMALL_INT = 10
# Identifier/date fields whose digits aren't metrics (UUIDs, week starts).
NON_METRIC_KEYS = {"accountId", "weekStart", "handle", "platform", "role"}
RATIO_TOLERANCE = 0.01
# Words right after a number that pin which metric it must come from.
FIELD_HINTS = [
    (re.compile(r"^\s*(percentile|pctl)\b", re.I), lambda key: "Percentile" in key),
    (re.compile(r"^\s*(posts?\s*)?(/|per)\s*(week|wk)\b", re.I), lambda key: key == "postsPerWeek"),
    (re.compile(r"^\s*posts?\b", re.I), lambda key: key == "postCount"),
    (re.compile(r"^\s*followers?\b", re.I), lambda key: key == "followers"),
]


@dataclass
class Cited:
    text: str
    value: float
    decimals: int
    suffix: str
    field_hint: object = None  # predicate over metric field names, when the wording pins one


@dataclass
class Check:
    cited: Cited
    status: str  # grounded | derived | misattributed | unverifiable | ungrounded | ignored
    matched: float | None = None


@dataclass
class ClaimResult:
    analysis_id: str
    section: str
    claim: str
    checks: list[Check] = field(default_factory=list)

    @property
    def status(self) -> str:
        statuses = {c.status for c in self.checks if c.status != "ignored"}
        if not statuses:
            return "no numbers"
        for worst in ("ungrounded", "misattributed", "unverifiable", "derived"):
            if worst in statuses:
                return worst
        return "grounded"


def parse_numbers(text: str) -> list[tuple[Cited, bool]]:
    """Every number in `text`, paired with whether it reads as a time span (e.g. "90-day")."""
    found = []
    text = ISO_DATE_RE.sub(" ", text)
    for m in NUMBER_RE.finditer(text):
        raw = m.group("num")
        suffix = (m.group("suffix") or "").strip().lower().replace("×", "x")
        if suffix == "x" and RATE_AFTER_RE.match(text[m.end() :]):
            suffix = ""
        decimals = len(raw.split(".")[1]) if "." in raw else 0
        value = float(raw.replace(",", ""))
        after = text[m.end() :]
        is_time = bool(TIME_AFTER_RE.match(after)) or (decimals == 0 and 2000 <= value <= 2100)
        hint = next((pred for pattern, pred in FIELD_HINTS if pattern.match(after)), None)
        if suffix in ("th", "st", "nd", "rd"):
            hint = FIELD_HINTS[0][1]
        found.append((Cited(m.group(0), value, decimals, suffix, hint), is_time))
    return found


def numeric_leaves(obj) -> list[float]:
    """All numbers in a JSON value, including numbers written inside its strings."""
    out: list[float] = []
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, (int, float)):
        out.append(abs(float(obj)))
    elif isinstance(obj, str):
        out.extend(c.value for c, _ in parse_numbers(obj))
    elif isinstance(obj, dict):
        for key, value in obj.items():
            if key not in NON_METRIC_KEYS:
                out.extend(numeric_leaves(value))
    elif isinstance(obj, list):
        for value in obj:
            out.extend(numeric_leaves(value))
    return out


def leaves_by_key(obj, path: str = "") -> dict[str, list[float]]:
    """Numbers grouped by field name (last path segment), e.g. all 'avgEngagement' values."""
    groups: dict[str, list[float]] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                groups.setdefault(key, []).append(abs(float(value)))
            else:
                for k, v in leaves_by_key(value, key).items():
                    groups.setdefault(k, []).extend(v)
    elif isinstance(obj, list):
        for value in obj:
            for k, v in leaves_by_key(value, path).items():
                groups.setdefault(k, []).extend(v)
    return groups


class Evidence:
    """The numbers an LLM call was given, indexed for matching."""

    def __init__(self, platform_metrics: list[dict], company_name: str):
        self.by_account: dict[str, list[float]] = {}
        self.fields_by_account: dict[str, dict[str, list[float]]] = {}
        self.ratio_groups: list[list[float]] = []
        self.aliases: dict[str, str] = {}  # lowercased name in text -> handle
        for pm in platform_metrics:
            for account in pm.get("accounts", []):
                handle = account["handle"].lower()
                values = numeric_leaves(account)
                self.by_account.setdefault(handle, []).extend(values)
                fields = self.fields_by_account.setdefault(handle, {})
                for key, vals in leaves_by_key(account).items():
                    fields.setdefault(key, []).extend(vals)
                self.ratio_groups.append(values)
                self.aliases[handle] = handle
                if account["role"] == "target":
                    self.aliases[company_name.lower()] = handle
            for values in leaves_by_key(pm).values():
                self.ratio_groups.append(values)

    def values_for(self, cited: Cited, handles: set[str] | None = None) -> list[float]:
        """Candidate values for a citation: restricted to the hinted field, and to `handles` if given."""
        accounts = handles if handles is not None else set(self.by_account)
        if cited.field_hint is None:
            return [v for h in accounts for v in self.by_account.get(h, [])]
        return [
            v
            for h in accounts
            for key, vals in self.fields_by_account.get(h, {}).items()
            if cited.field_hint(key)
            for v in vals
        ]

    def handles_in(self, text: str) -> set[str]:
        lowered = text.lower()
        return {handle for alias, handle in self.aliases.items() if alias in lowered}


def _tolerance(cited: Cited, scale: float = 1.0) -> float:
    # A number shown with d decimals could be any value that rounds to it; suffixed
    # numbers (247K) are often truncated rather than rounded, so allow a full unit.
    unit = 10 ** -cited.decimals
    return unit * scale if scale != 1.0 else unit / 2 + 1e-9


def _candidates(cited: Cited) -> list[tuple[float, float]]:
    """(value, tolerance) pairs this citation could be referring to."""
    v = cited.value
    if cited.suffix == "k":
        return [(v * 1e3, _tolerance(cited, 1e3))]
    if cited.suffix == "m":
        return [(v * 1e6, _tolerance(cited, 1e6))]
    if cited.suffix == "%":
        return [(v, _tolerance(cited)), (v / 100, _tolerance(cited) / 100)]
    return [(v, _tolerance(cited))]


def _matches(cited: Cited, values: list[float]) -> float | None:
    for target, tol in _candidates(cited):
        for value in values:
            if abs(value - target) <= tol:
                return value
    return None


def _ratio_match(cited: Cited, groups: list[list[float]]) -> float | None:
    """An "Nx" figure that's the ratio of two values from the same account or the same metric."""
    if cited.value == 0:
        return None
    for values in groups:
        for a, b in permutations(set(values), 2):
            # "roughly 19x" for 19.5 is common, so allow a full display unit either way.
            if b and abs(a / b - cited.value) <= max(10**-cited.decimals, RATIO_TOLERANCE * cited.value):
                return a / b
    return None


def check_claim(claim: str, evidence: Evidence) -> list[Check]:
    named = evidence.handles_in(claim)
    check_attribution = len(named) == 1 and not COMPARISON_RE.search(claim)
    named_groups = [[v for h in named for v in evidence.by_account.get(h, [])]] if named else []
    checks = []
    for cited, is_time in parse_numbers(claim):
        if is_time:
            checks.append(Check(cited, "ignored"))
            continue
        hit = _matches(cited, evidence.values_for(cited, named)) if named else None
        if hit is not None:
            checks.append(Check(cited, "grounded", hit))
            continue
        if cited.suffix == "x":
            ratio = _ratio_match(cited, named_groups) or _ratio_match(cited, evidence.ratio_groups)
            if ratio is not None:
                checks.append(Check(cited, "derived", ratio))
                continue
        hit = _matches(cited, evidence.values_for(cited))
        if hit is not None:
            checks.append(Check(cited, "misattributed" if check_attribution else "grounded", hit))
        elif cited.decimals == 0 and not cited.suffix and cited.value <= SMALL_INT:
            # "3 competitors", "one of 4 categories": counts the metrics don't list directly.
            checks.append(Check(cited, "unverifiable"))
        else:
            checks.append(Check(cited, "ungrounded"))
    return checks


def collect_claims() -> list[ClaimResult]:
    analyses = {a["id"]: a for a in fetch_all("analyses", "id, company_name, status")}
    insights = fetch_all("analysis_insights", "analysis_id, platform, metrics, data_observations, explanations")
    reports = fetch_all("analysis_reports", "analysis_id, report_type, content")

    per_platform: dict[str, list[dict]] = {}
    for row in insights:
        if row["platform"] != "all":
            per_platform.setdefault(row["analysis_id"], []).append(row["metrics"])

    results: list[ClaimResult] = []

    def add(analysis_id: str, section: str, claims: list[str], evidence: Evidence) -> None:
        for claim in claims or []:
            results.append(ClaimResult(analysis_id, section, claim, check_claim(claim, evidence)))

    for row in insights:
        analysis = analyses.get(row["analysis_id"])
        if not analysis:
            continue
        # The 'all' row only stores {"platforms": [...]}, but the cross-platform call was
        # given every platform's metrics, so that's the evidence it's checked against.
        source = per_platform.get(row["analysis_id"], []) if row["platform"] == "all" else [row["metrics"]]
        evidence = Evidence(source, analysis["company_name"])
        add(row["analysis_id"], f"{row['platform']} / observations", row["data_observations"], evidence)
        add(row["analysis_id"], f"{row['platform']} / explanations", row["explanations"], evidence)

    for row in reports:
        analysis = analyses.get(row["analysis_id"])
        content = row["content"] or {}
        if row["report_type"] != "customer" or not analysis:
            continue
        evidence = Evidence(per_platform.get(row["analysis_id"], []), analysis["company_name"])
        for key in ("key_findings", "working_content_patterns", "competitive_gaps"):
            add(row["analysis_id"], f"customer / {key}", content.get(key), evidence)

    return results


def render(results: list[ClaimResult]) -> str:
    def rate(rows: list[ClaimResult]) -> str:
        checkable = [r for r in rows if r.status != "no numbers"]
        if not checkable:
            return "-"
        ok = sum(r.status in ("grounded", "derived") for r in checkable)
        return f"{ok}/{len(checkable)} ({100 * ok / len(checkable):.0f}%)"

    numbers = [c for r in results for c in r.checks if c.status != "ignored"]
    counts = {s: sum(c.status == s for c in numbers) for s in ("grounded", "derived", "misattributed", "unverifiable", "ungrounded")}

    out = ["# Synthesis grounding check", ""]
    out.append(
        "Every number cited in the LLM-written observations, explanations, and customer findings, "
        "matched against the metrics JSON that call was given. Recommendations and plans are skipped "
        "because their numbers are targets, not claims about the data."
    )
    out.append("")
    out.append(f"**Claims fully grounded: {rate(results)}** (claims with at least one number)")
    out.append("")
    out.append("| Number status | Count | Meaning |")
    out.append("| --- | --- | --- |")
    out.append(f"| grounded | {counts['grounded']} | Appears in the metrics (after rounding / unit conversion) |")
    out.append(f"| derived | {counts['derived']} | An \"Nx\" ratio of two real values |")
    out.append(f"| misattributed | {counts['misattributed']} | Real number, but only under an account the claim doesn't name |")
    out.append(f"| unverifiable | {counts['unverifiable']} | Small count (<= {SMALL_INT}) not stored as a metric |")
    out.append(f"| ungrounded | {counts['ungrounded']} | Not found anywhere in the data the model saw |")
    out.append("")

    out.append("| Analysis | Section | Grounded claims |")
    out.append("| --- | --- | --- |")
    keys = sorted({(r.analysis_id, r.section) for r in results})
    for analysis_id, section in keys:
        rows = [r for r in results if r.analysis_id == analysis_id and r.section == section]
        out.append(f"| `{analysis_id[:8]}` | {section} | {rate(rows)} |")
    out.append("")

    flagged = [r for r in results if r.status in ("ungrounded", "misattributed")]
    out.append(f"## Flagged claims ({len(flagged)})")
    out.append("")
    for r in flagged:
        bad = [c for c in r.checks if c.status in ("ungrounded", "misattributed")]
        detail = "; ".join(
            f"`{c.cited.text.strip()}` {c.status}" + (f" (value {c.matched:g} belongs to another account)" if c.matched is not None else "")
            for c in bad
        )
        out.append(f"- **`{r.analysis_id[:8]}` {r.section}**: {detail}")
        out.append(f"  > {r.claim}")
    return "\n".join(out)


def run() -> str:
    report = render(collect_claims()) + "\n\n## How much to trust this check\n\n```\n" + mutation_test() + "\n```"
    REPORTS_DIR.mkdir(exist_ok=True)
    (REPORTS_DIR / "grounding.md").write_text(report + "\n")
    return report


def _mutate(claim: str, rng) -> tuple[str, str, str] | None:
    """Replace one real number (> SMALL_INT) in `claim` with a plausible fake. Returns (kind, original, mutated)."""
    clean = ISO_DATE_RE.sub(" ", claim)
    spans = [
        m
        for m in NUMBER_RE.finditer(clean)
        if not TIME_AFTER_RE.match(clean[m.end() :]) and float(m.group("num").replace(",", "")) > SMALL_INT
    ]
    if not spans:
        return None
    m = rng.choice(spans)
    raw = m.group("num")
    decimals = len(raw.split(".")[1]) if "." in raw else 0
    kind = rng.choice(["small (x1.1-1.3)", "large (x1.5-3)"])
    factor = rng.uniform(1.1, 1.3) if kind.startswith("small") else rng.uniform(1.5, 3.0)
    fake_value = float(raw.replace(",", "")) * factor
    fake = f"{fake_value:,.{decimals}f}" if "," in raw else f"{fake_value:.{decimals}f}"
    return kind, f"{raw} -> {fake}", clean[: m.start("num")] + fake + clean[m.end("num") :]


def mutation_test(rounds: int = 20) -> str:
    """Eval the eval: corrupt one real number per observation and see how often the checker notices.

    A checker that grounds everything would also score 100% on real claims, so a perfect grounding
    rate only means something alongside a high detection rate here.
    """
    import random

    analyses = {a["id"]: a for a in fetch_all("analyses", "id, company_name")}
    rows = [
        r
        for r in fetch_all("analysis_insights", "analysis_id, platform, metrics, data_observations")
        if r["platform"] != "all" and r["analysis_id"] in analyses
    ]

    by_kind: dict[str, list[int]] = {}
    missed: list[str] = []
    for seed in range(rounds):
        rng = random.Random(seed)
        for row in rows:
            evidence = Evidence([row["metrics"]], analyses[row["analysis_id"]]["company_name"])
            for claim in row["data_observations"]:
                mutation = _mutate(claim, rng)
                if mutation is None:
                    continue
                kind, change, mutated = mutation
                detected = any(c.status in ("ungrounded", "misattributed") for c in check_claim(mutated, evidence))
                tally = by_kind.setdefault(kind, [0, 0])
                tally[0] += detected
                tally[1] += 1
                if not detected and len(missed) < 3:
                    missed.append(f"{change} in: {mutated}")

    caught = sum(hit for hit, _ in by_kind.values())
    trials = sum(n for _, n in by_kind.values())
    lines = [
        f"Mutation test ({rounds} rounds): corrupted one number per observation in {trials} trials; "
        f"the checker flagged {caught} ({100 * caught / trials:.0f}%)."
    ]
    for kind, (hit, n) in sorted(by_kind.items()):
        lines.append(f"  {kind}: {hit}/{n} caught ({100 * hit / n:.0f}%)")
    if missed:
        lines.append("Example misses (the fake value happened to land near another real metric):")
        lines.extend(f"  {m[:240]}" for m in missed)
    return "\n".join(lines)
