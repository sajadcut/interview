import assert from "node:assert/strict";
import test from "node:test";
import {
  containsPersianScript,
  normalizeInterviewSpokenLanguage,
} from "./interview-language";

test("normalizes supported Persian language forms", () => {
  for (const value of ["fa", "fa-IR", "fa_IR", "FA-ir", "persian"]) {
    assert.equal(normalizeInterviewSpokenLanguage(value), "fa");
  }
});

test("defaults unknown and missing languages to English", () => {
  for (const value of [undefined, null, "", "en", "en-US", "de", 42]) {
    assert.equal(normalizeInterviewSpokenLanguage(value), "en");
  }
});

test("detects Persian script without treating English as Persian", () => {
  assert.equal(containsPersianScript("مصاحبه هوشمند"), true);
  assert.equal(containsPersianScript("Backend interview"), false);
  assert.equal(containsPersianScript("Backend و طراحی سیستم"), true);
});
