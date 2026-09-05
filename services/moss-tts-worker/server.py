from __future__ import annotations

import hmac
import importlib.util
import io
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from fa_tech_normalizer import normalize_technical_terms

CONTRACT_VERSION = "tts-synthesis.v1"
PROVIDER = "moss-realtime-persian"
MAX_TEXT_CHARS = 4000
MAX_REQUEST_BYTES = 32 * 1024
SAMPLE_RATE = 24000
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")

_ENGINE: "MossPersianEngine | None" = None
_ENGINE_LOCK = threading.Lock()


def load_root_env() -> None:
    candidates = [Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]
    for candidate in candidates:
        if not candidate.exists():
            continue
        for raw_line in candidate.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
        return


load_root_env()


def shared_secret() -> str:
    return os.getenv("TTS_SHARED_SECRET", "").strip() or os.getenv("MEDIA_WORKER_SHARED_SECRET", "").strip()


def normalize_request_id(value: str | None) -> str | None:
    candidate = (value or "").strip()
    return candidate if REQUEST_ID_PATTERN.fullmatch(candidate) else None


def _load_function(path: str, module_name: str, function_name: str) -> Callable[[str], Any]:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {module_name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    function = getattr(module, function_name, None)
    if not callable(function):
        raise RuntimeError(f"{function_name} is missing from {module_name}")
    return function


class MossPersianEngine:
    def __init__(self) -> None:
        configured_repo = os.getenv("MOSS_TTS_REPO_DIR", "").strip()
        if not configured_repo:
            raise RuntimeError("MOSS_TTS_REPO_DIR is required")
        repo_dir = Path(configured_repo)
        realtime_dir = repo_dir / "moss_tts_realtime"
        if not realtime_dir.is_dir():
            raise RuntimeError("MOSS_TTS_REPO_DIR does not contain moss_tts_realtime")
        sys.path.insert(0, str(realtime_dir.resolve()))

        try:
            import soundfile as sf
            import torch
            from huggingface_hub import hf_hub_download
            from peft import PeftModel
            from transformers import AutoModel, AutoTokenizer
            from inferencer import MossTTSRealtimeInference
            from mossttsrealtime.modeling_mossttsrealtime import MossTTSRealtime
        except ImportError as exc:
            raise RuntimeError(f"MOSS TTS dependency is missing: {exc.name}") from exc

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA GPU is required for the MOSS Persian realtime test")

        self.torch = torch
        self.soundfile = sf
        self.adapter = os.getenv("MOSS_TTS_ADAPTER", "hamidfzm/MOSS-TTS-Realtime-Persian-lora").strip()
        self.base = os.getenv("MOSS_TTS_BASE_MODEL", "OpenMOSS-Team/MOSS-TTS-Realtime").strip()
        self.codec_name = os.getenv("MOSS_TTS_CODEC_MODEL", "OpenMOSS-Team/MOSS-Audio-Tokenizer").strip()
        self.temperature = float(os.getenv("MOSS_TTS_TEMPERATURE", "0.8"))

        major, _minor = torch.cuda.get_device_capability()
        dtype = torch.bfloat16 if major >= 8 else torch.float16

        print(f"Loading MOSS Persian TTS on {torch.cuda.get_device_name(0)} ({dtype})...")
        model = MossTTSRealtime.from_pretrained(self.base, torch_dtype=dtype, attn_implementation="sdpa")
        model = PeftModel.from_pretrained(model, self.adapter).merge_and_unload().to("cuda").eval()
        tokenizer = AutoTokenizer.from_pretrained(self.base)
        codec = AutoModel.from_pretrained(self.codec_name, trust_remote_code=True).eval().to("cuda")
        self.codec = codec
        self.inferencer = MossTTSRealtimeInference(
            model,
            tokenizer,
            max_length=1200,
            codec=codec,
            codec_sample_rate=SAMPLE_RATE,
            codec_encode_kwargs={"chunk_duration": 8},
        )

        configured_ref = os.getenv("MOSS_TTS_REFERENCE_AUDIO", "").strip()
        self.reference_audio = (
            str(Path(configured_ref).resolve())
            if configured_ref
            else hf_hub_download(self.adapter, "ref.wav")
        )
        if not Path(self.reference_audio).is_file():
            raise RuntimeError("MOSS_TTS_REFERENCE_AUDIO does not exist")

        normalize_path = hf_hub_download(self.adapter, "fa_normalize.py")
        self.fa_normalize = _load_function(normalize_path, "moss_persian_fa_normalize", "normalize")
        self.fa_chunk = _load_function(normalize_path, "moss_persian_fa_chunk", "chunk")
        print("MOSS Persian TTS ready")

    def synthesize(self, spoken_text: str) -> bytes:
        normalized = normalize_technical_terms(spoken_text.strip())
        normalized = self.fa_normalize(normalized)
        pieces = list(self.fa_chunk(normalized))
        pieces = [piece for piece in pieces if isinstance(piece, str) and piece.strip()]
        if not pieces:
            raise ValueError("text normalization produced no utterances")

        # The upstream Persian demo applies this guard because a cold generation can
        # swallow the first word without a leading pause/punctuation token.
        guarded = [piece if piece[0] in "،.؛!؟…," else f"، {piece}" for piece in pieces]
        torch = self.torch
        parts = []
        gap = torch.zeros(int(0.3 * SAMPLE_RATE))
        with torch.inference_mode():
            for piece in guarded:
                result = self.inferencer.generate(
                    text=[piece],
                    reference_audio_path=[self.reference_audio],
                    temperature=self.temperature,
                    top_p=0.6,
                    top_k=30,
                    repetition_penalty=1.1,
                    repetition_window=50,
                    device="cuda",
                )
                tokens = torch.tensor(result[0]).to("cuda")
                waveform = self.codec.decode(tokens.permute(1, 0), chunk_duration=8)["audio"][0].cpu().detach()
                parts.extend([waveform if waveform.ndim == 1 else waveform.squeeze(0), gap])

        audio = torch.cat(parts[:-1]).float().numpy()
        output = io.BytesIO()
        self.soundfile.write(output, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        return output.getvalue()


def is_authorized(handler: BaseHTTPRequestHandler) -> bool:
    expected = shared_secret()
    supplied = handler.headers.get("x-tts-secret", "") or handler.headers.get("x-media-worker-secret", "")
    return bool(expected) and hmac.compare_digest(expected, supplied)


def write_json(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.send_header("x-tts-contract-version", CONTRACT_VERSION)
    handler.end_headers()
    handler.wfile.write(data)


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    try:
        length = int(handler.headers.get("content-length", "0") or "0")
    except ValueError as exc:
        raise ValueError("invalid content-length") from exc
    if length <= 0 or length > MAX_REQUEST_BYTES:
        raise ValueError("invalid request size")
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError("incomplete request body")
    return body


class Handler(BaseHTTPRequestHandler):
    server_version = "interview-moss-tts-worker/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Do not log spoken text or secrets.
        super().log_message(format, *args)

    def do_GET(self) -> None:
        if self.path != "/health":
            write_json(self, 404, {"error": "Not Found"})
            return
        ready = _ENGINE is not None and bool(shared_secret())
        payload = {
            "contractVersion": CONTRACT_VERSION,
            "provider": PROVIDER,
            "ready": ready,
            "sampleRate": SAMPLE_RATE,
            "device": "cuda",
            "independentOf": ["llm", "whisper", "livekit", "ffmpeg"],
        }
        if not shared_secret():
            payload["reason"] = "TTS shared secret is not configured"
        write_json(self, 200 if ready else 503, payload)

    def do_POST(self) -> None:
        if self.path != "/synthesize":
            write_json(self, 404, {"error": "Not Found"})
            return
        request_id = normalize_request_id(self.headers.get("x-request-id"))
        if not is_authorized(self):
            write_json(self, 401, {"error": {"code": "unauthorized", "message": "TTS request is unauthorized"}})
            return
        if self.headers.get("x-tts-contract-version", "").strip() != CONTRACT_VERSION:
            write_json(self, 409, {"error": {"code": "contract_mismatch", "message": "TTS contract version does not match"}})
            return
        if request_id is None:
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        if self.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            write_json(self, 415, {"error": {"code": "unsupported_media_type", "message": "TTS request content type is unsupported"}})
            return
        try:
            payload = json.loads(read_body(self).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        if not isinstance(payload, dict) or set(payload) != {"spokenText"}:
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        spoken_text = payload.get("spokenText")
        if not isinstance(spoken_text, str) or not spoken_text.strip() or len(spoken_text.strip()) > MAX_TEXT_CHARS:
            write_json(self, 400, {"error": {"code": "invalid_request", "message": "TTS request is invalid"}})
            return
        if _ENGINE is None:
            write_json(self, 503, {"error": {"code": "provider_unavailable", "message": "TTS engine is unavailable"}})
            return
        try:
            with _ENGINE_LOCK:
                audio = _ENGINE.synthesize(spoken_text)
        except Exception:
            write_json(self, 502, {"error": {"code": "provider_error", "message": "TTS engine failed"}})
            return

        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(audio)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-tts-contract-version", CONTRACT_VERSION)
        self.send_header("x-tts-provider", PROVIDER)
        self.send_header("x-request-id", request_id)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    global _ENGINE
    if not shared_secret():
        raise RuntimeError("TTS_SHARED_SECRET or MEDIA_WORKER_SHARED_SECRET is required")
    _ENGINE = MossPersianEngine()
    host = os.getenv("MOSS_TTS_WORKER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("MOSS_TTS_WORKER_PORT", "9021"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"MOSS Persian TTS worker listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
