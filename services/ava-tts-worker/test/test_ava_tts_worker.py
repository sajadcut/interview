from __future__ import annotations

import http.client
import json
import os
import sys
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def wav_bytes() -> bytes:
    import io
    import wave

    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(server.SAMPLE_RATE)
        handle.writeframes(b"\x00\x00" * 240)
    return output.getvalue()


class FakeEngine:
    def synthesize(self, spoken_text: str) -> bytes:
        if not spoken_text.strip():
            raise RuntimeError("empty")
        return wav_bytes()


class AvaWorkerContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.previous_secret = os.environ.get("MEDIA_WORKER_SHARED_SECRET")
        os.environ["MEDIA_WORKER_SHARED_SECRET"] = "ava-contract-test-secret"
        self.previous_engine = server._ENGINE
        server._ENGINE = FakeEngine()

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.httpd.server_address[1]

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server._ENGINE = self.previous_engine
        if self.previous_secret is None:
            os.environ.pop("MEDIA_WORKER_SHARED_SECRET", None)
        else:
            os.environ["MEDIA_WORKER_SHARED_SECRET"] = self.previous_secret

    def request(self, method: str, path: str, body: bytes | None = None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            payload = response.read()
            return response.status, dict(response.getheaders()), payload
        finally:
            connection.close()

    def test_health_identifies_cpu_ava_runtime(self) -> None:
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("x-tts-contract-version"), server.CONTRACT_VERSION)
        payload = json.loads(body)
        self.assertEqual(payload["provider"], "ava-82m-persian-cpu")
        self.assertEqual(payload["device"], "cpu")
        self.assertEqual(payload["modelVersion"], "0.2.0")
        self.assertEqual(payload["contentType"], "audio/wav")
        self.assertTrue(payload["ready"])

    def test_synthesis_echoes_request_id_and_returns_valid_wav(self) -> None:
        request_id = "tts:ava-contract-001"
        body = json.dumps({"spokenText": "سلام"}).encode("utf-8")
        status, headers, payload = self.request(
            "POST",
            "/synthesize",
            body=body,
            headers={
                "content-type": "application/json",
                "content-length": str(len(body)),
                "x-tts-secret": "ava-contract-test-secret",
                "x-tts-contract-version": server.CONTRACT_VERSION,
                "x-request-id": request_id,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("content-type"), "audio/wav")
        self.assertEqual(headers.get("x-tts-provider"), "ava-82m-persian-cpu")
        self.assertEqual(headers.get("x-request-id"), request_id)
        server.validate_wav_bytes(payload)

    def test_synthesis_rejects_missing_request_id(self) -> None:
        body = json.dumps({"spokenText": "سلام"}).encode("utf-8")
        status, _, payload = self.request(
            "POST",
            "/synthesize",
            body=body,
            headers={
                "content-type": "application/json",
                "content-length": str(len(body)),
                "x-tts-secret": "ava-contract-test-secret",
                "x-tts-contract-version": server.CONTRACT_VERSION,
            },
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(payload)["error"]["code"], "invalid_request")


if __name__ == "__main__":
    unittest.main()
