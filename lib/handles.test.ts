import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHandle } from "./handles";

test("cleanHandle strips @ and whitespace", () => {
  assert.equal(cleanHandle("  @nasa "), "nasa");
  assert.equal(cleanHandle("some.brand_01"), "some.brand_01");
});

test("cleanHandle rejects anything that is not a username", () => {
  assert.equal(cleanHandle("evil handle; rm"), null);
  assert.equal(cleanHandle("https://instagram.com/x"), null);
  assert.equal(cleanHandle(""), null);
});
