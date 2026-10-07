# Classifier eval

Gold set: 0 hand-labeled posts (see `ml/data/labeling_guide.md`). Overall numbers are reweighted by sampling stratum, so they estimate performance on the full post population; the confusion matrix shows raw counts.

## Summary

| Source | Accuracy | Macro-F1 | ECE (calibration error) | Agreement with production (kappa) | Cost |
| --- | --- | --- | --- | --- | --- |

## Production self-consistency (no labels needed)

137 posts were scraped in two analyses and classified independently each time. The two runs agreed on 93.4% of them (kappa 0.90).
Most common splits: collaboration / product (2), campaign / product (2), campaign / collaboration (1), collaboration / paid_promotion (1), collaboration / testimonial (1).

_No gold labels yet, so accuracy and calibration aren't measured. Run `python -m onvibe_ml label` to hand-label the queue in `ml/data/label_queue.csv`._
