import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTopicGaps } from "./synthesize";
import type { KgBuildResult } from "./graph";

const graph: KgBuildResult = {
  targets: ["@us"],
  competitors: ["@them"],
  gaps: [{ topic: "behind the scenes", medianLift: 2.14, postCount: 5, accounts: ["@them"] }],
  targetOnlyTopics: [{ topic: "podcasts", medianLift: 1.1, postCount: 3 }],
  competitorPostCount: 40,
};

test("describeTopicGaps is empty without a graph", () => {
  assert.equal(describeTopicGaps(null), "");
});

test("describeTopicGaps lists gaps per competitor and the target's own topics", () => {
  const text = describeTopicGaps(graph);
  assert.match(text, /40 competitor posts/);
  assert.match(text, /"competitor": "@them"/);
  assert.match(text, /"lift": 2.1/);
  assert.match(text, /only the target covers: podcasts/);
});

test("describeTopicGaps says so when no topic cleared the bar", () => {
  assert.match(describeTopicGaps({ ...graph, gaps: [], targetOnlyTopics: [] }), /No topic met the bar/);
});
