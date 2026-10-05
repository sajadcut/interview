from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fa_tech_normalizer import normalize_technical_terms


class PersianTechnicalNormalizerTest(unittest.TestCase):
    def test_common_backend_terms_are_spoken_in_persian(self) -> None:
        source = "Backend API روی PostgreSQL و Kubernetes با Node.js ساخته شد."
        normalized = normalize_technical_terms(source)
        self.assertIn("بک‌اند", normalized)
        self.assertIn("اِی پی آی", normalized)
        self.assertIn("پُستگرس", normalized)
        self.assertIn("کوبرنتیز", normalized)
        self.assertIn("نود جی‌اِس", normalized)
        self.assertNotIn("Backend", normalized)

    def test_case_insensitive_terms_are_normalized(self) -> None:
        self.assertEqual(normalize_technical_terms("backend FRONTEND api"), "بک‌اند فرانت‌اند اِی پی آی")

    def test_embedded_ascii_identifiers_are_not_rewritten(self) -> None:
        self.assertEqual(normalize_technical_terms("backendService"), "backendService")

    def test_dotnet_interview_terms_are_spoken_phonetically(self) -> None:
        normalized = normalize_technical_terms(
            "ASP.NET با Entity Framework و SQL و dependency injection و RabbitMQ"
        )
        self.assertIn("اِی اِس پی دات‌نِت", normalized)
        self.assertIn("اِنتیتی فِریم‌وِرک", normalized)
        self.assertIn("اِس‌کیو‌اِل", normalized)
        self.assertIn("دِپِندِنسی اینجِکشن", normalized)
        self.assertIn("رَبیت اِم‌کیو", normalized)

    def test_reported_persian_pronunciation_ambiguities_are_marked(self) -> None:
        self.assertEqual(
            normalize_technical_terms("تخصیص منابع و تخصص فنی"),
            "تَخصیص منابع و تَخَصُّص فنی",
        )

    def test_dotnet_and_language_names_are_normalized(self) -> None:
        normalized = normalize_technical_terms(".NET, C#, C++ و TypeScript")
        self.assertEqual(normalized, "دات‌نِت, سی شارپ, سی پلاس پلاس و تایپ‌اسکریپت")


if __name__ == "__main__":
    unittest.main()
