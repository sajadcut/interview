from pathlib import Path

path = Path("apps/api/src/interviews/evaluator-shadow-testing.service.ts")
text = path.read_text()
old = '''  return {
    ...base,
    visibilityState: "sealed",
    humanOutcomeRecorded: false,
    aiResult: null,
    comparison: null,
  };'''
new = '''  return {
    ...base,
    visibilityState: "sealed",
    humanOutcomeRecorded: false,
    aiResult: null,
    execution: null,
    humanOutcome: null,
    comparison: null,
  };'''
if old not in text:
    raise SystemExit("sealed run response anchor not found")
path.write_text(text.replace(old, new, 1))
