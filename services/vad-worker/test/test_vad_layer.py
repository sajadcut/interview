from __future__ import annotations

import io
import unittest
import wave
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vad_layer import (  # noqa: E402
    CONTRACT_VERSION,
    MAX_AUDIO_SECONDS,
    VADError,
    VADAnalyzer,
    vad_status,
)


def wav_bytes(*, seconds: float = 0.05, sample_rate: int = 16000) -> bytes:
    frames = max(1, int(seconds * sample_rate))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


class FakeEngine:
    def __init__(self, segments=None, error: Exception | None = None) -> None:
        self.segments = segments if segments is not None else [{"start": 0.01, "end": 0.03}]
        self.error = error
        self.paths: list[Path] = []

    def ensure_ready(self) -> str:
        if self.error:
            raise self.error
        return "fake-1.0"

    def analyze_path(self, audio_path: Path):
        self.paths.append(audio_path)
        if self.error:
            raise self.error
        return self.segments


class VADLayerTests(unittest.TestCase):
    def test_status_is_component_local_and_versioned(self) -> None:
        status = vad_status(shared_secret="test-secret", engine=FakeEngine())
        self.assertTrue(status["ready"])
        self.assertEqual(status["contractVersion"], CONTRACT_VERSION)
        self.assertEqual(
            status["independentOf"],
            ["llm", "whisper", "livekit", "ffmpeg", "tts"],
        )

    def test_analyzer_normalizes_fake_engine_segments(self) -> None:
        result = VADAnalyzer(engine=FakeEngine()).analyze(wav_bytes())
        self.assertTrue(result["speechDetected"])
        self.assertEqual(result["sampleRate"], 16000)
        self.assertEqual(
            result["segments"],
            [{"startSeconds": 0.01, "endSeconds": 0.03}],
        )

    def test_analyzer_accepts_no_speech(self) -> None:
        result = VADAnalyzer(engine=FakeEngine(segments=[])).analyze(wav_bytes())
        self.assertFalse(result["speechDetected"])
        self.assertEqual(result["segments"], [])

    def test_invalid_wav_is_rejected_before_engine(self) -> None:
        engine = FakeEngine()
        with self.assertRaises(VADError) as raised:
            VADAnalyzer(engine=engine).analyze(b"not-a-wav")
        self.assertEqual(raised.exception.code, "invalid_audio")
        self.assertEqual(engine.paths, [])

    def test_overlapping_provider_segments_fail_closed(self) -> None:
        engine = FakeEngine(
            segments=[
                {"start": 0.01, "end": 0.03},
                {"start": 0.02, "end": 0.04},
            ]
        )
        with self.assertRaises(VADError) as raised:
            VADAnalyzer(engine=engine).analyze(wav_bytes())
        self.assertEqual(raised.exception.code, "invalid_provider_output")

    def test_engine_failure_maps_to_safe_provider_error(self) -> None:
        engine = FakeEngine(error=RuntimeError("sensitive engine trace"))
        with self.assertRaises(VADError) as raised:
            VADAnalyzer(engine=engine).analyze(wav_bytes())
        self.assertEqual(raised.exception.code, "provider_error")
        self.assertNotIn("sensitive engine trace", str(raised.exception))

    def test_temporary_audio_is_removed_after_success(self) -> None:
        engine = FakeEngine()
        VADAnalyzer(engine=engine).analyze(wav_bytes())
        self.assertEqual(len(engine.paths), 1)
        self.assertFalse(engine.paths[0].exists())

    def test_audio_duration_limit_is_enforced_without_real_silero(self) -> None:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(1)
            out.setframerate(8000)
            out.writeframes(b"\x00" * int((MAX_AUDIO_SECONDS + 0.1) * 8000))
        with self.assertRaises(VADError) as raised:
            VADAnalyzer(engine=FakeEngine()).analyze(buffer.getvalue())
        self.assertEqual(raised.exception.code, "invalid_request")


if __name__ == "__main__":
    unittest.main()
