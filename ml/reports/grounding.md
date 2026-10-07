# Synthesis grounding check

Every number cited in the LLM-written observations, explanations, and customer findings, matched against the metrics JSON that call was given. Recommendations and plans are skipped because their numbers are targets, not claims about the data.

**Claims fully grounded: 78/78 (100%)** (claims with at least one number)

| Number status | Count | Meaning |
| --- | --- | --- |
| grounded | 307 | Appears in the metrics (after rounding / unit conversion) |
| derived | 6 | An "Nx" ratio of two real values |
| misattributed | 0 | Real number, but only under an account the claim doesn't name |
| unverifiable | 0 | Small count (<= 10) not stored as a metric |
| ungrounded | 0 | Not found anywhere in the data the model saw |

| Analysis | Section | Grounded claims |
| --- | --- | --- |
| `63eb2caf` | all / explanations | 4/4 (100%) |
| `63eb2caf` | all / observations | 5/5 (100%) |
| `63eb2caf` | customer / competitive_gaps | 2/2 (100%) |
| `63eb2caf` | customer / key_findings | 3/3 (100%) |
| `63eb2caf` | customer / working_content_patterns | - |
| `63eb2caf` | instagram / explanations | 4/4 (100%) |
| `63eb2caf` | instagram / observations | 5/5 (100%) |
| `7928152d` | all / explanations | 3/3 (100%) |
| `7928152d` | all / observations | 4/4 (100%) |
| `7928152d` | customer / competitive_gaps | 1/1 (100%) |
| `7928152d` | customer / key_findings | 2/2 (100%) |
| `7928152d` | customer / working_content_patterns | 1/1 (100%) |
| `7928152d` | instagram / explanations | 3/3 (100%) |
| `7928152d` | instagram / observations | 6/6 (100%) |
| `a4be3358` | all / explanations | 3/3 (100%) |
| `a4be3358` | all / observations | 4/4 (100%) |
| `a4be3358` | customer / competitive_gaps | 1/1 (100%) |
| `a4be3358` | customer / key_findings | 2/2 (100%) |
| `a4be3358` | customer / working_content_patterns | - |
| `a4be3358` | instagram / explanations | 3/3 (100%) |
| `a4be3358` | instagram / observations | 6/6 (100%) |
| `dd048a25` | all / explanations | 4/4 (100%) |
| `dd048a25` | all / observations | 3/3 (100%) |
| `dd048a25` | customer / competitive_gaps | - |
| `dd048a25` | customer / key_findings | 1/1 (100%) |
| `dd048a25` | customer / working_content_patterns | - |
| `dd048a25` | instagram / explanations | 3/3 (100%) |
| `dd048a25` | instagram / observations | 5/5 (100%) |

## Flagged claims (0)


## How much to trust this check

```
Mutation test (20 rounds): corrupted one number per observation in 420 trials; the checker flagged 398 (95%).
  large (x1.5-3): 205/215 caught (95%)
  small (x1.1-1.3): 193/205 caught (94%)
Example misses (the fake value happened to land near another real metric):
  18 -> 20 in: OnVibe's collaboration posts average 38.75 engagement vs a 5.38 baseline (7.2x multiplier) on just 4 posts, the strongest category lift in the dataset, while educational (20 posts, 0.27x) and product (19 posts, 0.48x) posts und
  22 -> 47 in: For nasa, carousel posts show the highest avgEngagement (364,355.26 across 35 posts) versus image (289,517.5, 38 posts) and video (186,511.36, 47 posts) — despite video underperforming on engagement, nasa's overall avgViews (1,
  25 -> 28 in: Smart Transfer's mediaTypeBreakdown shows carousel content averaging 2.83 engagement vs. 2.4 for image and 2.67 for video across a comparably small post base (12/15/9 posts), and its avgViewsPercentile sits at 28, the same tier
```
