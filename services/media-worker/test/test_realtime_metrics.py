from __future__ import annotations

import io
import os
import sys
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

MEDIA_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MEDIA_WORKER_ROOT))

import realtime_metrics  # noqa: E402
import server  # noqa: E402


def make_wav(duration_seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\x00\x00" * int(duration_seconds * sample_rate))
    return buffer.getvalue()


class RealtimeMetricsContractTests(unittest.TestCase):
    def test_contract_is_loaded_and_registry_emits_only_observed_series(self) -> None:
        registry = realtime_metrics.RealtimeMetricsRegistry()
        self.assertEqual(realtime_metrics.CONTRACT_VERSION, "v1")
        self.assertGreaterEqual(len(realtime_metrics.DEFINITIONS), 20)
        self.assertEqual(registry.render(), "")

        registry.increment(
            "interview_realtime_livekit_operations_total",
            operation="health_probe",
            result="success",
        )
        registry.observe(
            "interview_realtime_livekit_operation_duration_seconds",
            0.4,
            operation="health_probe",
        )
        text = registry.render()
        self.assertIn(
            'interview_realtime_livekit_operations_total{operation="health_probe",result="success"} 1',
            text,
        )
        self.assertIn(
            'interview_realtime_livekit_operation_duration_seconds_bucket{operation="health_probe",le="0.5"} 1',
            text,
        )
        self.assertNotIn("candidate", text)
        self.assertNotIn("room_reference", text)

    def test_contract_rejects_unbounded_or_unknown_label_values(self) -> None:
        registry = realtime_metrics.RealtimeMetricsRegistry()
        with self.assertRaises(ValueError):
            registry.increment(
                "interview_realtime_livekit_reconnects_total",
                reason="candidate-123",
            )
        with self.assertRaises(ValueError):
            registry.observe(
                "interview_realtime_livekit_packet_loss_ratio",
                0.1,
                media="audio",
                direction="sideways",
            )

    def test_gate_f_e2e_bucket_is_part_of_contract(self) -> None:
        definition = realtime_metrics.DEFINITIONS["interview_realtime_turn_duration_seconds"]
        self.assertIn(1.8, definition.buckets)
        self.assertIn("e2e", definition.labels["stage"])


class WhisperInstrumentationTests(unittest.TestCase):
    def test_wav_duration_is_measured_without_external_dependencies(self) -> None:
        duration = server.wav_duration_seconds(make_wav(1.25))
        self.assertIsNotNone(duration)
        self.assertAlmostEqual(duration or 0, 1.25, places=2)
        self.assertIsNone(server.wav_duration_seconds(b"not-a-wav"))

    @patch.dict(
        os.environ,
        {
            "WHISPER_MODEL_PATH": "/tmp/model.gguf",
            "WHISPER_LANGUAGE": "en",
            "WHISPER_TIMEOUT_SECONDS": "5",
        },
        clear=False,
    )
    @patch.object(server, "resolve_command", return_value="/usr/bin/whisper-cli")
    @patch.object(server, "record_whisper_request")
    @patch.object(server.subprocess, "run")
    def test_run_whisper_records_success_and_audio_duration(
        self,
        run_mock,
        metrics_mock,
        _resolve_mock,
    ) -> None:
        def fake_run(args, **_kwargs):
            output_prefix = Path(args[args.index("--output-file") + 1])
            output_prefix.with_suffix(".txt").write_text("hello", encoding="utf-8")
            return SimpleNamespace(returncode=0, stderr="")

        run_mock.side_effect = fake_run
        result = server.run_whisper(make_wav(1.0))
        self.assertEqual(result["text"], "hello")
        metrics_mock.assert_called_once()
        kwargs = metrics_mock.call_args.kwargs
        self.assertEqual(kwargs["result"], "success")
        self.assertAlmostEqual(kwargs["audio_duration_seconds"], 1.0, places=2)
        self.assertFalse(kwargs["empty_transcript"])
        self.assertGreaterEqual(kwargs["processing_duration_seconds"], 0)

    @patch.dict(
        os.environ,
        {
            "WHISPER_MODEL_PATH": "/tmp/model.gguf",
            "WHISPER_TIMEOUT_SECONDS": "1",
        },
        clear=False,
    )
    @patch.object(server, "resolve_command", return_value="/usr/bin/whisper-cli")
    @patch.object(server, "record_whisper_request")
    @patch.object(server.subprocess, "run")
    def test_run_whisper_records_timeout(
        self,
        run_mock,
        metrics_mock,
        _resolve_mock,
    ) -> None:
        run_mock.side_effect = server.subprocess.TimeoutExpired(cmd="whisper-cli", timeout=1)
        with self.assertRaises(server.subprocess.TimeoutExpired):
            server.run_whisper(make_wav(0.5))
        kwargs = metrics_mock.call_args.kwargs
        self.assertEqual(kwargs["result"], "timeout")
        self.assertAlmostEqual(kwargs["audio_duration_seconds"], 0.5, places=2)


if __name__ == "__main__":
    unittest.main()
