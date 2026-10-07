# Post category labeling guide

The gold labels in `gold_labels.csv` are the spec the classifier is scored against, so
label by these definitions, not by gut feel. Pick exactly one category per post. When a
post fits more than one, apply the tie-breaks in order.

| Key | Category | Use when the post's main purpose is... |
| --- | --- | --- |
| 1 | `collaboration` | Content made *with* another account or person: a co-authored post, a creator feature, a partner shout-out, an employee/community spotlight, with no sign it was paid. |
| 2 | `campaign` | A time-bound push: a launch event, a sale, a contest/giveaway, a holiday or awareness-day post, a named series with a hashtag. |
| 3 | `paid_promotion` | Sponsored content: "Paid partnership", `#ad`, `#sponsored`, or explicit sponsorship language. |
| 4 | `product` | Showing or selling the account's own product or service: features, demos, pricing, "try it now", app screenshots. |
| 5 | `testimonial` | A customer, user, or third party vouching for the product: reviews, case studies, user results, quotes. |
| 6 | `educational` | Teaching something useful on its own: tips, how-tos, explainers, industry facts, science/news content. |
| 7 | `other` | None of the above: memes, culture/fun posts, hiring, company news, greetings with no other purpose. |

## Tie-breaks (apply in order)

1. Any clear sponsorship signal -> `paid_promotion`, whatever else the post does.
2. A customer/user vouching for the product -> `testimonial`, even if it shows the product.
3. Time-bound (event, sale, contest, dated launch) -> `campaign`, even if it shows the product.
4. Co-created or featuring another account, unpaid -> `collaboration`.
5. Teaches something that would be useful without buying anything -> `educational`, even
   if the product is mentioned in passing; if the lesson is just a wrapper for a product
   pitch, use `product`.

If the caption is empty or you genuinely can't tell, press `s` to skip rather than guess.
A skipped post is left out of the eval, and a guessed label just adds noise.
