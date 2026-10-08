import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "./concurrency";

test("limiter never runs more than the limit at once and runs every task", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = async (n: number) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n;
  };
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(() => task(n))));
  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
});

test("limiter keeps going after a task throws", async () => {
  const limit = createLimiter(1);
  await assert.rejects(limit(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(await limit(async () => "ok"), "ok");
});
