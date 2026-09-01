import assert from "node:assert/strict";
import test from "node:test";
import { isIanaTimezone } from "./timezone";

test("scheduling timezone validation accepts IANA zones and UTC", () => {
  assert.equal(isIanaTimezone("Europe/Berlin"), true);
  assert.equal(isIanaTimezone("Asia/Tehran"), true);
  assert.equal(isIanaTimezone("UTC"), true);
});

test("scheduling timezone validation rejects arbitrary labels", () => {
  assert.equal(isIanaTimezone("Berlin time"), false);
  assert.equal(isIanaTimezone(""), false);
});
