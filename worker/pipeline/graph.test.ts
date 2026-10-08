import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeGraph, parseKgOutput } from "./graph";

const output = JSON.stringify({
  analysisId: "a1",
  targets: ["@us"],
  competitors: ["@them"],
  gaps: [{ topic: "behind the scenes", medianLift: 2.1, postCount: 5, accounts: ["@them"] }],
  targetOnlyTopics: [],
  competitorPostCount: 40,
});

test("parseKgOutput reads the gaps JSON", () => {
  const result = parseKgOutput(output);
  assert.equal(result.gaps[0].topic, "behind the scenes");
  assert.equal(result.competitorPostCount, 40);
});

test("parseKgOutput rejects non-JSON and JSON without gaps", () => {
  assert.throws(() => parseKgOutput("Traceback (most recent call last)"), /other than JSON/);
  assert.throws(() => parseKgOutput("{}"), /missing gaps/);
  assert.throws(() => parseKgOutput("null"), /missing gaps/);
});

test("buildKnowledgeGraph returns the parsed result", async () => {
  const result = await buildKnowledgeGraph("a1", async (id) => (id === "a1" ? output : "{}"));
  assert.equal(result?.gaps.length, 1);
});

test("buildKnowledgeGraph returns null instead of throwing when the build fails", async (t) => {
  t.mock.method(console, "error", () => {});
  assert.equal(await buildKnowledgeGraph("a1", async () => Promise.reject(new Error("timed out"))), null);
  assert.equal(await buildKnowledgeGraph("a1", async () => "not json"), null);
});
