from __future__ import annotations

import re

# Keep this list deliberately conservative. These replacements are for the spoken
# rendering only; persisted rubric labels/evidence remain unchanged.
_TECH_TERMS: tuple[tuple[str, str], ...] = (
    ("ASP.NET", "اِی اِس پی دات‌نِت"),
    ("Entity Framework", "اِنتیتی فِریم‌وِرک"),
    ("dependency injection", "دِپِندِنسی اینجِکشن"),
    ("PostgreSQL", "پُستگرس"),
    ("RabbitMQ", "رَبیت اِم‌کیو"),
    ("microservice", "مایکروسِرویس"),
    ("Kubernetes", "کوبرنتیز"),
    ("TypeScript", "تایپ‌اسکریپت"),
    ("JavaScript", "جاوااسکریپت"),
    ("Next.js", "نکست جی‌اِس"),
    ("Node.js", "نود جی‌اِس"),
    ("backend", "بک‌اند"),
    ("front-end", "فرانت‌اند"),
    ("frontend", "فرانت‌اند"),
    ("GitHub", "گیت‌هاب"),
    ("Docker", "داکر"),
    ("Redis", "رِدیس"),
    ("React", "ری‌اَکت"),
    ("gRPC", "جی آر پی سی"),
    ("REST", "رِست"),
    ("LINQ", "لینک"),
    ("SQL", "اِس‌کیو‌اِل"),
    ("Azure", "اَژور"),
    ("AWS", "اِی دابِلیو اِس"),
    ("Kafka", "کافکا"),
    ("API", "اِی پی آی"),
    ("CI/CD", "سی آی، سی دی"),
    (".NET", "دات‌نِت"),
    ("C++", "سی پلاس پلاس"),
    ("C#", "سی شارپ"),
)

# A tiny deterministic lexicon for Persian words that the current voice commonly
# mispronounces. Keep it narrow; broader contextual ezafe/short-vowel decisions are
# supplied by the interviewer LLM in spokenText.
_PERSIAN_PRONUNCIATIONS: tuple[tuple[str, str], ...] = (
    ("تخصیص", "تَخصیص"),
    ("تخصص", "تَخَصُّص"),
)



def _term_pattern(term: str) -> re.Pattern[str]:
    escaped = re.escape(term)
    return re.compile(rf"(?<![A-Za-z0-9_]){escaped}(?![A-Za-z0-9_])", re.IGNORECASE)


_COMPILED_TERMS = tuple((_term_pattern(source), target) for source, target in _TECH_TERMS)


def normalize_technical_terms(text: str) -> str:
    """Normalize common English technical terms for Persian TTS pronunciation."""
    normalized = text
    for pattern, target in _COMPILED_TERMS:
        normalized = pattern.sub(target, normalized)
    for source, target in _PERSIAN_PRONUNCIATIONS:
        normalized = normalized.replace(source, target)
    return normalized
