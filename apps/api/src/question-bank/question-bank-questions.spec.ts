import assert from "node:assert/strict";
import test from "node:test";
import { extractQuestionCandidates, selectQuestionWindow } from "./question-bank-questions";

test("extracts and deduplicates actual Persian and technical questions", () => {
  const questions = extractQuestionCandidates([
    "۱. چرا برای سیستم توزیع‌شده Redis را انتخاب کردید؟",
    "۲. سناریوی شکست شبکه را چگونه مدیریت می‌کنید؟",
    "۱. چرا برای سیستم توزیع‌شده Redis را انتخاب کردید؟",
    "این قسمت صرفاً پاسخ نمونه است.",
    "How do you avoid race conditions in a distributed lock?",
  ].join("\n"));
  assert.equal(questions.length, 3);
  assert.match(questions[0] ?? "", /Redis/);
  assert.match(questions[2] ?? "", /distributed lock/);
});

test("rotates question windows without introducing unseen questions", () => {
  const questions = ["Question one?", "Question two?", "Question three?"];
  assert.deepEqual(selectQuestionWindow(questions, 0, 2), questions.slice(0, 2));
  assert.deepEqual(selectQuestionWindow(questions, 2, 2), [questions[2], questions[0]]);
  assert.deepEqual(selectQuestionWindow([], 7), []);
});
