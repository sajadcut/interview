from __future__ import annotations

import re

# Spoken rendering only. Persisted rubric/evidence text is not modified.
_TECH_TERMS: tuple[tuple[str, str], ...] = (
    ("PostgreSQL", "پُستگرس"),
    ("Kubernetes", "کوبرنتیز"),
    ("TypeScript", "تایپ‌اسکریپت"),
    ("JavaScript", "جاوااسکریپت"),
    ("Next.js", "نکست جی‌اِس"),
    ("Node.js", "نود جی‌اِس"),
    ("backend", "بک‌اند"),
    ("back-end", "بک‌اند"),
    ("frontend", "فرانت‌اند"),
    ("front-end", "فرانت‌اند"),
    ("GitHub", "گیت‌هاب"),
    ("Docker", "داکر"),
    ("Redis", "رِدیس"),
    ("React", "ری‌اَکت"),
    ("API", "اِی پی آی"),
    ("CI/CD", "سی آی، سی دی"),
    (".NET", "دات‌نِت"),
    ("C++", "سی پلاس پلاس"),
    ("C#", "سی شارپ"),
)


def _term_pattern(term: str) -> re.Pattern[str]:
    escaped = re.escape(term)
    return re.compile(rf"(?<![A-Za-z0-9_]){escaped}(?![A-Za-z0-9_])", re.IGNORECASE)


_COMPILED_TERMS = tuple((_term_pattern(source), target) for source, target in _TECH_TERMS)


def normalize_technical_terms(text: str) -> str:
    normalized = text
    for pattern, target in _COMPILED_TERMS:
        normalized = pattern.sub(target, normalized)
    return normalized
