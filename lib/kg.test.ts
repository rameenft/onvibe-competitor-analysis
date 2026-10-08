import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTopicGaps, groupGapsByCompetitor, type TopicGapInput } from "./kg";

const base: TopicGapInput = {
  targetIds: ["account:instagram:acme"],
  rivalIds: ["account:instagram:rivalco", "account:instagram:other"],
  accountNames: {
    "account:instagram:acme": "@acme",
    "account:instagram:rivalco": "@rivalco",
    "account:instagram:other": "@other",
  },
  topicNames: { "topic:cleanup": "phone cleanup", "topic:backup": "photo backup", "topic:memes": "memes" },
  posts: [],
  about: [],
};

function withPosts(rows: [id: string, account: string, lift: number | null, topic: string][]): TopicGapInput {
  return {
    ...base,
    posts: rows.map(([id, account, lift]) => ({ id, account: `account:instagram:${account}`, lift })),
    about: rows.map(([id, , , topic]) => ({ post: id, topic })),
  };
}

test("a topic rivals win on and the target never covers is a gap", () => {
  const { gaps, competitorPostCount } = computeTopicGaps(
    withPosts([
      ["p1", "rivalco", 1.5, "topic:cleanup"],
      ["p2", "rivalco", 1.2, "topic:cleanup"],
      ["p3", "other", 2.0, "topic:cleanup"],
    ]),
  );
  assert.equal(competitorPostCount, 3);
  assert.deepEqual(gaps, [{ topic: "phone cleanup", medianLift: 1.5, postCount: 3, accounts: ["@other", "@rivalco"] }]);
});

test("topics the target already covers are not gaps", () => {
  const { gaps } = computeTopicGaps(
    withPosts([
      ["p1", "rivalco", 1.5, "topic:backup"],
      ["p2", "rivalco", 1.5, "topic:backup"],
      ["p3", "other", 1.5, "topic:backup"],
      ["p4", "acme", 0.2, "topic:backup"],
    ]),
  );
  assert.deepEqual(gaps, []);
});

test("too few rival posts, or a median lift below 1, is not a gap", () => {
  const { gaps } = computeTopicGaps(
    withPosts([
      ["p1", "rivalco", 3.0, "topic:cleanup"],
      ["p2", "rivalco", 3.0, "topic:cleanup"],
      ["p3", "rivalco", 0.5, "topic:memes"],
      ["p4", "rivalco", 0.6, "topic:memes"],
      ["p5", "other", 0.9, "topic:memes"],
    ]),
  );
  assert.deepEqual(gaps, []);
});

test("gaps are ranked by median lift and capped at the limit", () => {
  const rows: [string, string, number | null, string][] = [];
  for (const [topic, lift] of [["topic:cleanup", 1.1], ["topic:backup", 2.4], ["topic:memes", 1.7]] as const) {
    for (let i = 0; i < 3; i++) rows.push([`${topic}-${i}`, "rivalco", lift, topic]);
  }
  const { gaps } = computeTopicGaps(withPosts(rows), 2);
  assert.deepEqual(gaps.map((g) => g.topic), ["photo backup", "memes"]);
});

test("a post with no lift counts as zero, matching the Python query", () => {
  const { gaps } = computeTopicGaps(
    withPosts([
      ["p1", "rivalco", null, "topic:cleanup"],
      ["p2", "rivalco", null, "topic:cleanup"],
      ["p3", "rivalco", 5, "topic:cleanup"],
    ]),
  );
  assert.deepEqual(gaps, []);
});

test("groupGapsByCompetitor makes one entry per competitor, strongest first", () => {
  const grouped = groupGapsByCompetitor([
    { topic: "photo backup", medianLift: 1.4, postCount: 4, accounts: ["@rivalco"] },
    { topic: "phone cleanup", medianLift: 2.5, postCount: 6, accounts: ["@other", "@rivalco"] },
    { topic: "backing up photos", medianLift: 1.2, postCount: 3, accounts: ["@rivalco"] },
  ]);
  assert.deepEqual(
    grouped.map((c) => [c.competitor, c.topics.map((t) => t.topic)]),
    [
      ["@other", ["phone cleanup"]],
      ["@rivalco", ["phone cleanup", "photo backup", "backing up photos"]],
    ],
  );
});

test("groupGapsByCompetitor keeps only the top topics per competitor", () => {
  const gaps = [1, 2, 3, 4, 5].map((n) => ({ topic: `t${n}`, medianLift: n, postCount: 3, accounts: ["@rivalco"] }));
  assert.deepEqual(groupGapsByCompetitor(gaps, 2)[0].topics.map((t) => t.topic), ["t5", "t4"]);
  assert.deepEqual(groupGapsByCompetitor([]), []);
});
