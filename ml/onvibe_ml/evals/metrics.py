"""Scoring functions for the classifier eval. Pure functions over lists, no I/O."""

from dataclasses import dataclass

import numpy as np
from sklearn.metrics import cohen_kappa_score, confusion_matrix, precision_recall_fscore_support


@dataclass
class ClassReport:
    label: str
    precision: float
    recall: float
    f1: float
    support: float  # weighted count of gold examples


def weighted_accuracy(gold: list[str], pred: list[str], weights: list[float]) -> float:
    correct = np.array([g == p for g, p in zip(gold, pred)], dtype=float)
    w = np.asarray(weights, dtype=float)
    return float((correct * w).sum() / w.sum())


def per_class(gold: list[str], pred: list[str], labels: list[str], weights: list[float]) -> list[ClassReport]:
    precision, recall, f1, support = precision_recall_fscore_support(
        gold, pred, labels=labels, sample_weight=weights, zero_division=0
    )
    return [
        ClassReport(label, float(p), float(r), float(f), float(s))
        for label, p, r, f, s in zip(labels, precision, recall, f1, support)
    ]


def macro_f1(reports: list[ClassReport]) -> float:
    """Unweighted mean F1 over classes that appear in the gold set."""
    present = [r.f1 for r in reports if r.support > 0]
    return float(np.mean(present)) if present else 0.0


def confusion(gold: list[str], pred: list[str], labels: list[str]) -> np.ndarray:
    """Raw (unweighted) counts: rows are gold labels, columns are predictions."""
    return confusion_matrix(gold, pred, labels=labels)


def expected_calibration_error(
    confidences: list[float], correct: list[bool], weights: list[float], n_bins: int = 10
) -> tuple[float, list[dict]]:
    """ECE: the weighted gap between stated confidence and observed accuracy, per confidence bin.

    Returns (ece, bins) where each bin reports its range, mean confidence, accuracy and weight,
    i.e. the data behind a reliability diagram.
    """
    conf = np.clip(np.asarray(confidences, dtype=float), 0.0, 1.0)
    hit = np.asarray(correct, dtype=float)
    w = np.asarray(weights, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    # Right-inclusive last bin so a confidence of exactly 1.0 is counted.
    bin_index = np.minimum(np.digitize(conf, edges[1:-1], right=True), n_bins - 1)

    total = w.sum()
    ece = 0.0
    bins = []
    for b in range(n_bins):
        mask = bin_index == b
        if not mask.any():
            continue
        bw = w[mask].sum()
        mean_conf = float((conf[mask] * w[mask]).sum() / bw)
        accuracy = float((hit[mask] * w[mask]).sum() / bw)
        ece += (bw / total) * abs(mean_conf - accuracy)
        bins.append(
            {
                "range": (float(edges[b]), float(edges[b + 1])),
                "mean_confidence": mean_conf,
                "accuracy": accuracy,
                "count": int(mask.sum()),
            }
        )
    return float(ece), bins


def selective_accuracy(
    confidences: list[float], correct: list[bool], weights: list[float], thresholds=(0.5, 0.7, 0.8, 0.9)
) -> list[dict]:
    """Accuracy and coverage if we only trusted predictions at or above each confidence threshold.

    This is the practical use of calibration: route low-confidence posts to a human or a
    stronger model, and know what accuracy the rest will have.
    """
    conf = np.asarray(confidences, dtype=float)
    hit = np.asarray(correct, dtype=float)
    w = np.asarray(weights, dtype=float)
    rows = []
    for t in thresholds:
        mask = conf >= t
        coverage = float(w[mask].sum() / w.sum())
        accuracy = float((hit[mask] * w[mask]).sum() / w[mask].sum()) if mask.any() else float("nan")
        rows.append({"threshold": t, "coverage": coverage, "accuracy": accuracy, "count": int(mask.sum())})
    return rows


def agreement(a: list[str], b: list[str]) -> dict:
    """How often two classifiers agree, raw and chance-corrected (Cohen's kappa)."""
    raw = float(np.mean([x == y for x, y in zip(a, b)])) if a else float("nan")
    kappa = float(cohen_kappa_score(a, b)) if len(set(a) | set(b)) > 1 else float("nan")
    return {"raw": raw, "kappa": kappa, "n": len(a)}
