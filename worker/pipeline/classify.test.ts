import { test } from "node:test";
import assert from "node:assert/strict";
import { keepValid } from "./classify";

const batch = [{ id: "a" }, { id: "b" }];
const row = (post_id: string, category: string, confidence = 0.9) =>
  ({ post_id, category, confidence, rationale: "r" }) as Parameters<typeof keepValid>[0][number];

test("keepValid drops ids that were not in the batch", () => {
  const result = keepValid([row("a", "product"), row("zzz", "product")], batch);
  assert.deepEqual(result.map((c) => c.post_id), ["a"]);
});

test("keepValid drops unknown categories and duplicate ids", () => {
  const result = keepValid([row("a", "memes"), row("b", "other"), row("b", "product")], batch);
  assert.deepEqual(result.map((c) => [c.post_id, c.category]), [["b", "other"]]);
});

test("keepValid clamps confidence into 0-1", () => {
  const [c] = keepValid([row("a", "product", 7)], batch);
  assert.equal(c.confidence, 1);
});
