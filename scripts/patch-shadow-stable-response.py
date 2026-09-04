from pathlib import Path

path = Path("apps/api/src/interviews/evaluator-shadow-testing.service.ts")
text = path.read_text()
old = '''      aiResult: null,
      comparison: null,'''
new = '''      aiResult: null,
      execution: null,
      humanOutcome: null,
      comparison: null,'''
if text.count(old) != 1:
    raise SystemExit(f"expected one sealed response anchor, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
