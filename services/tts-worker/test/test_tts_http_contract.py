from __future__ import annotations

import http.client
import json
import os
import shlex
import sys
import tempfile
import textwrap
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import Handler  # noqa: E402
from tts_layer import CONTRACT_VERSION  # noqa: E402


def quoted(value: str) -> str:
    return shlex.quote(value) if os.name != "nt" else f'"{value}"'


class TTSHttpContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        engine = root / "engine.py"
        engine.write_text(
            textwrap.dedent(
                """
                import sys, wave
                with wave.open(sys.argv[2], 'wb') as out:
                    out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
                    out.writeframes(b'\\x00\\x00' * 80)
                """
            ),
            encoding="utf-8",
        )
        self.previous = {key: os.environ.get(key) for key in ["TTS_SHARED_SECRET", "TTS_COMMAND", "TTS_TIMEOUT_SECONDS"]}
        os.environ["TTS_SHARED_SECRET"] = "contract-test-secret"
        os.environ["TTS_COMMAND"] = f"{quoted(sys.executable)} {quoted(str(engine))} {quoted('{text_file}')} {quoted('{output_wav}')}"
        os.environ["TTS_TIMEOUT_SECONDS"] = "2"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.directory.cleanup()

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        data = response.read()
        response_headers = dict(response.getheaders())
        connection.close()
        return response.status, response_headers, data

    def test_health_is_versioned_and_ready_without_other_services(self) -> None:
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("x-tts-contract-version"), CONTRACT_VERSION)
        payload = json.loads(body)
        self.assertTrue(payload["ready"])
        self.assertEqual(payload["independentOf"], ["llm", "whisper", "livekit", "ffmpeg"])

    def test_synthesize_returns_versioned_wav(self) -> None:
        request_id = "tts-http-test-001"
        status, headers, body = self.request(
            "POST",
            "/synthesize",
            body=json.dumps({"spokenText": "hello"}).encode(),
            headers={
                "content-type": "application/json",
                "x-tts-secret": "contract-test-secret",
                "x-tts-contract-version": CONTRACT_VERSION,
                "x-request-id": request_id,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("content-type"), "audio/wav")
        self.assertEqual(headers.get("x-tts-contract-version"), CONTRACT_VERSION)
        self.assertEqual(headers.get("x-request-id"), request_id)
        self.assertTrue(body.startswith(b"RIFF"))

    def test_synthesize_rejects_bad_contract_and_auth(self) -> None:
        body = json.dumps({"spokenText": "hello"}).encode()
        status, _, _ = self.request(
            "POST",
            "/synthesize",
            body=body,
            headers={
                "content-type": "application/json",
                "x-tts-secret": "wrong",
                "x-tts-contract-version": CONTRACT_VERSION,
                "x-request-id": "tts-http-test-002",
            },
        )
        self.assertEqual(status, 401)
        status, _, data = self.request(
            "POST",
            "/synthesize",
            body=body,
            headers={
                "content-type": "application/json",
                "x-tts-secret": "contract-test-secret",
                "x-tts-contract-version": "wrong.v1",
                "x-request-id": "tts-http-test-003",
            },
        )
        self.assertEqual(status, 409)
        self.assertEqual(json.loads(data)["error"]["code"], "contract_mismatch")


if __name__ == "__main__":
    unittest.main()
