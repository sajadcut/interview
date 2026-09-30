import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFaDigits, formatFaNumber, formatFaPercent } from "./fa-numbers";
test("Persian counts and grouping", () => {
  assert.equal(formatFaNumber(0), "۰");
  assert.equal(formatFaNumber(1234), "۱٬۲۳۴");
  assert.equal(formatFaNumber(Number.NaN), "—");
});
test("raw percentage values are not multiplied", () => {
  assert.equal(formatFaPercent(50), "۵۰٪");
  assert.equal(formatFaPercent(91.5), "۹۱٫۵٪");
});
test("Persian display text conversion does not touch the original input", () => {
  const raw = "2 پرونده · 10 مصاحبه";
  assert.equal(formatFaDigits(raw), "۲ پرونده · ۱۰ مصاحبه");
  assert.equal(raw, "2 پرونده · 10 مصاحبه");
});
