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
from unittest.mock import patch

MEDIA_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MEDIA_WORKER_ROOT))

import server  # noqa: E402
import whisper_contract  # noqa: E402


def make_wav(duration_seconds: float = 0.1, sample_rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"\x00\x00" * int(duration_seconds * sample_rate))
    return buffer.getvalue()


class WhisperContractUnitTests(unittest.TestCase):
    def test_contract_has_stable_errors_and_request_ids(self) -> None:
        self.assertEqual(whisper_contract.CONTRACT_VERSION, "whisper-stt.v1")
        self.assertEqual(whisper_contract.MAX_AUDIO_BYTES, 20 * 1024 * 1024)
        self.assertEqual(whisper_contract.ERRORS["provider_timeout"][:2], (504, True))
        self.assertEqual(whisper_contract.ERRORS["unsupported_media_type"][:2], (415, False))
        self.assertEqual(whisper_contract.normalize_request_id("request-test-001"), "request-test-001")
        self.assertIsNone(whisper_contract.normalize_request_id("bad id"))

    def test_error_payload_does_not_accept_provider_diagnostics(self) -> None:
        payload = whisper_contract.error_payload("provider_error", "request-test-002")
        serialized = json.dumps(payload)
        self.assertNotIn("stderr", serialized)
        self.assertNotIn("traceback", serialized)
        self.assertEqual(payload["error"]["retryable"], True)

    def test_whisper_decode_defaults_are_accuracy_oriented(self) -> None:
        with patch.dict(
            os.environ,
            {
                "WHISPER_BEAM_SIZE": "",
                "WHISPER_BEST_OF": "",
                "WHISPER_INITIAL_PROMPT": "",
            },
            clear=False,
        ):
            settings = server.whisper_decode_settings()
        self.assertEqual(settings["beamSize"], 5)
        self.assertEqual(settings["bestOf"], 5)
        self.assertEqual(settings["initialPrompt"], "")

    def test_whisper_decode_settings_are_bounded_and_prompt_is_capped(self) -> None:
        with patch.dict(
            os.environ,
            {
                "WHISPER_BEAM_SIZE": "0",
                "WHISPER_BEST_OF": "999",
                "WHISPER_INITIAL_PROMPT": "x" * (server.MAX_WHISPER_PROMPT_CHARS + 50),
            },
            clear=False,
        ):
            settings = server.whisper_decode_settings()
        self.assertEqual(settings["beamSize"], 1)
        self.assertEqual(settings["bestOf"], 32)
        self.assertEqual(len(settings["initialPrompt"]), server.MAX_WHISPER_PROMPT_CHARS)

    def test_whisper_cli_args_include_accuracy_settings_and_optional_prompt(self) -> None:
        prompt = "مصاحبه، هوشمند، منابع انسانی، رزومه، مهارت"
        with patch.dict(
            os.environ,
            {
                "WHISPER_BEAM_SIZE": "7",
                "WHISPER_BEST_OF": "6",
                "WHISPER_INITIAL_PROMPT": prompt,
            },
            clear=False,
        ):
            args = server.build_whisper_args(
                "whisper-cli",
                "model.bin",
                Path("input.wav"),
                Path("transcript"),
                "fa",
            )
        self.assertEqual(args[args.index("--beam-size") + 1], "7")
        self.assertEqual(args[args.index("--best-of") + 1], "6")
        self.assertEqual(args[args.index("--prompt") + 1], prompt)
        self.assertEqual(args[args.index("--language") + 1], "fa")


class WhisperHttpContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.secret_patch = patch.dict(os.environ, {"MEDIA_WORKER_SHARED_SECRET": "test-media-secret"}, clear=False)
        self.secret_patch.start()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.port = int(self.httpd.server_address[1])

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.secret_patch.stop()

    def request(self, path: str, *, body: bytes = b"", headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], dict]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        request_headers = headers or {}
        connection.request("POST" if path.endswith("finalize") else "GET", path, body=body, headers=request_headers)
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        response_headers = {key.lower(): value for key, value in response.getheaders()}
        connection.close()
        return response.status, response_headers, payload

    def stt_headers(self, request_id: str = "request-test-003") -> dict[str, str]:
        return {
            "content-type": "audio/wav",
            "x-media-worker-secret": "test-media-secret",
            "x-stt-contract-version": whisper_contract.CONTRACT_VERSION,
            "x-request-id": request_id,
        }

    @patch.object(server, "stt_status")
    def test_health_is_versioned_without_whisper_installed(self, status_mock) -> None:
        status_mock.return_value = {
            "contractVersion": whisper_contract.CONTRACT_VERSION,
            "provider": whisper_contract.PROVIDER,
            "ready": True,
            "maxAudioBytes": whisper_contract.MAX_AUDIO_BYTES,
            "supportedContentTypes": list(whisper_contract.SUPPORTED_AUDIO_CONTENT_TYPES),
        }
        status, headers, payload = self.request("/stt/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers["x-stt-contract-version"], whisper_contract.CONTRACT_VERSION)
        self.assertEqual(payload["provider"], "whisper.cpp")
        self.assertTrue(payload["ready"])

    def test_finalize_requires_auth_and_contract_version(self) -> None:
        status, _headers, payload = self.request(
            "/stt/finalize",
            body=make_wav(),
            headers={
                "content-type": "audio/wav",
                "x-stt-contract-version": whisper_contract.CONTRACT_VERSION,
                "x-request-id": "request-test-004",
            },
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"]["code"], "unauthorized")

        headers = self.stt_headers("request-test-005")
        headers["x-stt-contract-version"] = "whisper-stt.v0"
        status, _headers, payload = self.request("/stt/finalize", body=make_wav(), headers=headers)
        self.assertEqual(status, 409)
        self.assertEqual(payload["error"]["code"], "contract_mismatch")

    def test_finalize_rejects_unsupported_media_and_invalid_wav(self) -> None:
        headers = self.stt_headers("request-test-006")
        headers["content-type"] = "audio/mpeg"
        status, _response_headers, payload = self.request("/stt/finalize", body=b"mp3", headers=headers)
        self.assertEqual(status, 415)
        self.assertEqual(payload["error"]["code"], "unsupported_media_type")

        headers = self.stt_headers("request-test-007")
        with patch.object(server, "stt_status", return_value={"ready": True}):
            status, _response_headers, payload = self.request("/stt/finalize", body=b"not-a-wav", headers=headers)
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"]["code"], "invalid_audio")

    def test_finalize_maps_unavailable_and_timeout_without_provider_text(self) -> None:
        headers = self.stt_headers("request-test-008")
        with patch.object(server, "stt_status", return_value={"ready": False, "reason": "sensitive model path"}), patch.object(server, "record_whisper_request"):
            status, _response_headers, payload = self.request("/stt/finalize", body=make_wav(), headers=headers)
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"]["code"], "provider_unavailable")
        self.assertNotIn("sensitive model path", json.dumps(payload))

        headers = self.stt_headers("request-test-009")
        with patch.object(server, "stt_status", return_value={"ready": True}), patch.object(
            server,
            "run_whisper",
            side_effect=server.subprocess.TimeoutExpired(cmd="whisper-cli", timeout=1),
        ):
            status, _response_headers, payload = self.request("/stt/finalize", body=make_wav(), headers=headers)
        self.assertEqual(status, 504)
        self.assertEqual(payload["error"]["code"], "provider_timeout")
        self.assertEqual(payload["error"]["retryable"], True)

    def test_finalize_success_is_versioned_and_correlated(self) -> None:
        request_id = "request-test-010"
        with patch.object(server, "stt_status", return_value={"ready": True}), patch.object(
            server,
            "run_whisper",
            return_value={"text": "hello", "language": "en", "isFinal": True, "provider": "whisper.cpp"},
        ):
            status, headers, payload = self.request(
                "/stt/finalize",
                body=make_wav(),
                headers=self.stt_headers(request_id),
            )
        self.assertEqual(status, 200)
        self.assertEqual(headers["x-stt-contract-version"], whisper_contract.CONTRACT_VERSION)
        self.assertEqual(payload["requestId"], request_id)
        self.assertEqual(payload["contractVersion"], whisper_contract.CONTRACT_VERSION)
        self.assertEqual(payload["provider"], "whisper.cpp")
        self.assertEqual(payload["text"], "hello")
        self.assertTrue(payload["isFinal"])


if __name__ == "__main__":
    unittest.main()
