from __future__ import annotations

import http.client
import io
import json
import os
import sys
import threading
import unittest
import wave
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import vad_layer  # noqa: E402
from server import Handler  # noqa: E402
from vad_layer import CONTRACT_VERSION  # noqa: E402


def wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


class FakeEngine:
    def ensure_ready(self) -> str:
        return "fake-silero-1.0"

    def analyze_path(self, _audio_path: Path):
        return [{"start": 0.01, "end": 0.04}]


class VADHttpContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_secret = os.environ.get("MEDIA_WORKER_SHARED_SECRET")
        os.environ["MEDIA_WORKER_SHARED_SECRET"] = "contract-test-secret"
        self.previous_engine = vad_layer._ENGINE
        vad_layer._ENGINE = FakeEngine()  # type: ignore[assignment]
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        vad_layer._ENGINE = self.previous_engine
        if self.previous_secret is None:
            os.environ.pop("MEDIA_WORKER_SHARED_SECRET", None)
        else:
            os.environ["MEDIA_WORKER_SHARED_SECRET"] = self.previous_secret

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        response_headers = dict(response.getheaders())
        connection.close()
        return response.status, response_headers, data

    def test_health_is_ready_without_other_realtime_components(self) -> None:
        for key in ["LLM_PROVIDER", "STT_PROVIDER", "MEDIA_TRANSPORT_PROVIDER", "FFMPEG_ENABLED", "TTS_PROVIDER"]:
            os.environ[key] = "disabled"
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("x-vad-contract-version"), CONTRACT_VERSION)
        payload = json.loads(body)
        self.assertTrue(payload["ready"])
        self.assertEqual(
            payload["independentOf"],
            ["llm", "whisper", "livekit", "ffmpeg", "tts"],
        )

    def test_analyze_returns_versioned_structured_segments(self) -> None:
        request_id = "vad-http-test-001"
        status, headers, body = self.request(
            "POST",
            "/analyze",
            body=wav_bytes(),
            headers={
                "content-type": "audio/wav",
                "x-vad-secret": "contract-test-secret",
                "x-vad-contract-version": CONTRACT_VERSION,
                "x-request-id": request_id,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("x-vad-contract-version"), CONTRACT_VERSION)
        payload = json.loads(body)
        self.assertEqual(payload["requestId"], request_id)
        self.assertEqual(payload["provider"], "silero-vad")
        self.assertTrue(payload["speechDetected"])
        self.assertEqual(payload["segments"], [{"startSeconds": 0.01, "endSeconds": 0.04}])

    def test_analyze_rejects_bad_auth_and_contract(self) -> None:
        audio = wav_bytes()
        status, _, _ = self.request(
            "POST",
            "/analyze",
            body=audio,
            headers={
                "content-type": "audio/wav",
                "x-vad-secret": "wrong",
                "x-vad-contract-version": CONTRACT_VERSION,
                "x-request-id": "vad-http-test-002",
            },
        )
        self.assertEqual(status, 401)
        status, _, body = self.request(
            "POST",
            "/analyze",
            body=audio,
            headers={
                "content-type": "audio/wav",
                "x-vad-secret": "contract-test-secret",
                "x-vad-contract-version": "wrong.v1",
                "x-request-id": "vad-http-test-003",
            },
        )
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(body)["error"]["code"], "contract_mismatch")

    def test_analyze_rejects_invalid_audio_without_exposing_diagnostics(self) -> None:
        status, _, body = self.request(
            "POST",
            "/analyze",
            body=b"bad-audio",
            headers={
                "content-type": "audio/wav",
                "x-vad-secret": "contract-test-secret",
                "x-vad-contract-version": CONTRACT_VERSION,
                "x-request-id": "vad-http-test-004",
            },
        )
        self.assertEqual(status, 422)
        payload = json.loads(body)
        self.assertEqual(payload["error"]["code"], "invalid_audio")
        self.assertNotIn("wave", payload["error"]["message"].lower())


if __name__ == "__main__":
    unittest.main()
