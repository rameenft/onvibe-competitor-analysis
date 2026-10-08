import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachPercentiles,
  computeCategoryBreakdown,
  computeCollaborationCadence,
  computeMediaTypeBreakdown,
  percentileRank,
  type PostRow,
} from "./metrics";
import type { AccountMetrics } from "../../lib/types";

function post(overrides: Partial<PostRow> & { category?: string }): PostRow {
  const { category, ...rest } = overrides;
  return {
    id: "p",
    likes: 0,
    comments: 0,
    shares: null,
    views: null,
    media_type: "image",
    post_categories: category ? { category } : null,
    ...rest,
  };
}

test("percentileRank counts values at or below, as a whole percent", () => {
  assert.equal(percentileRank(5, [1, 5, 9, 10]), 50);
  assert.equal(percentileRank(10, [1, 5, 9, 10]), 100);
  assert.equal(percentileRank(1, [1, 5, 9, 10]), 25);
  assert.equal(percentileRank(3, []), 0);
});

test("media type breakdown groups by type and treats missing type as unknown", () => {
  const result = computeMediaTypeBreakdown([
    post({ likes: 10, comments: 0, media_type: "reel" }),
    post({ likes: 20, comments: 10, media_type: "reel" }),
    post({ likes: 4, comments: 0, media_type: null }),
  ]);
  assert.deepEqual(result.reel, { postCount: 2, avgEngagement: 20 });
  assert.deepEqual(result.unknown, { postCount: 1, avgEngagement: 4 });
});

test("collaboration cadence compares collab + paid posts against the account baseline", () => {
  const posts = [
    post({ likes: 10, category: "collaboration" }),
    post({ likes: 30, category: "paid_promotion" }),
    post({ likes: 5, category: "educational" }),
    post({ likes: 5, category: "product" }),
  ];
  // baseline = (10+30+5+5)/4 = 12.5; collab avg = 20 -> 1.6x
  assert.deepEqual(computeCollaborationCadence(posts), { postCount: 2, avgEngagement: 20, vsBaselineMultiplier: 1.6 });
});

test("collaboration cadence has no multiplier when there are no collab posts", () => {
  const result = computeCollaborationCadence([post({ likes: 10, category: "product" })]);
  assert.equal(result.postCount, 0);
  assert.equal(result.vsBaselineMultiplier, null);
});

test("category breakdown skips uncategorized posts and handles array-shaped joins", () => {
  const result = computeCategoryBreakdown(
    [
      post({ likes: 10, category: "product" }),
      post({ likes: 30, post_categories: [{ category: "product" }] }),
      post({ likes: 99 }), // no category: excluded
    ],
    20,
  );
  assert.deepEqual(Object.keys(result), ["product"]);
  assert.deepEqual(result.product, { postCount: 2, avgEngagement: 20, vsBaselineMultiplier: 1 });
});

test("category breakdown reports no multiplier when the baseline is zero", () => {
  const result = computeCategoryBreakdown([post({ likes: 0, category: "other" })], 0);
  assert.equal(result.other.vsBaselineMultiplier, null);
});

test("percentiles rank views only among accounts that have views", () => {
  const base = { engagementRate: 0, followers: 0, avgLikes: 0, avgViews: null } as AccountMetrics;
  const ranked = attachPercentiles([
    { ...base, handle: "a", avgViews: 100 },
    { ...base, handle: "b", avgViews: 300 },
    { ...base, handle: "c", avgViews: null },
  ]);
  assert.equal(ranked[0].avgViewsPercentile, 50);
  assert.equal(ranked[1].avgViewsPercentile, 100);
  assert.equal(ranked[2].avgViewsPercentile, null);
});
