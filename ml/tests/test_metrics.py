import math

from onvibe_ml.evals import metrics


def test_weighted_accuracy_reweights_strata():
    # Two strata: "a" is 90% of the population but only half the sample.
    gold = ["a", "a", "b", "b"]
    pred = ["a", "a", "a", "a"]  # always right on a, always wrong on b
    unweighted = metrics.weighted_accuracy(gold, pred, [1, 1, 1, 1])
    reweighted = metrics.weighted_accuracy(gold, pred, [9, 9, 1, 1])
    assert unweighted == 0.5
    assert math.isclose(reweighted, 0.9)


def test_per_class_and_macro_f1():
    gold = ["a", "a", "b", "c"]
    pred = ["a", "b", "b", "c"]
    reports = {r.label: r for r in metrics.per_class(gold, pred, ["a", "b", "c", "d"], [1, 1, 1, 1])}
    assert reports["a"].precision == 1.0 and reports["a"].recall == 0.5
    assert reports["b"].precision == 0.5 and reports["b"].recall == 1.0
    assert reports["d"].support == 0  # absent from gold: excluded from macro-F1
    assert math.isclose(metrics.macro_f1(list(reports.values())), (2 / 3 + 2 / 3 + 1.0) / 3)


def test_ece_is_zero_when_confidence_matches_accuracy():
    # 80% confident, right 4 out of 5 times.
    ece, bins = metrics.expected_calibration_error([0.8] * 5, [True] * 4 + [False], [1] * 5)
    assert math.isclose(ece, 0.0, abs_tol=1e-9)
    assert len(bins) == 1 and bins[0]["count"] == 5


def test_ece_catches_overconfidence():
    ece, _ = metrics.expected_calibration_error([0.95] * 4, [True, False, False, False], [1] * 4)
    assert math.isclose(ece, 0.70)


def test_ece_counts_confidence_of_exactly_one():
    _, bins = metrics.expected_calibration_error([1.0, 1.0], [True, True], [1, 1])
    assert bins[-1]["range"] == (0.9, 1.0) and bins[-1]["count"] == 2


def test_selective_accuracy_trades_coverage_for_accuracy():
    conf = [0.95, 0.9, 0.6, 0.4]
    correct = [True, True, False, False]
    rows = {r["threshold"]: r for r in metrics.selective_accuracy(conf, correct, [1] * 4)}
    assert rows[0.9]["coverage"] == 0.5 and rows[0.9]["accuracy"] == 1.0
    assert rows[0.5]["coverage"] == 0.75


def test_agreement_kappa():
    same = metrics.agreement(["a", "b", "a", "b"], ["a", "b", "a", "b"])
    assert same["raw"] == 1.0 and math.isclose(same["kappa"], 1.0)
    flipped = metrics.agreement(["a", "b", "a", "b"], ["b", "a", "b", "a"])
    assert flipped["raw"] == 0.0 and flipped["kappa"] < 0
