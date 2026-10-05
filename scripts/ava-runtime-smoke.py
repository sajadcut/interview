from __future__ import annotations

from ava_tts import Ava

MODEL_ID = "xmanii/Ava-82M"
TEXT = "سلام، این یک آزمون کوتاه برای آوای فارسی است."
EXPECTED_SAMPLE_RATE = 24_000
MINIMUM_SAMPLES = 2_400


def sample_count(audio: object) -> int:
    numel = getattr(audio, "numel", None)
    if callable(numel):
        return int(numel())
    return len(audio)  # type: ignore[arg-type]


def main() -> None:
    tts = Ava.from_pretrained(MODEL_ID, device="cpu")
    result = tts.generate(TEXT)

    audio = result.audio
    sample_rate = int(result.sample_rate)
    samples = sample_count(audio)

    if sample_rate != EXPECTED_SAMPLE_RATE:
        raise RuntimeError(f"unexpected sample rate: {sample_rate}")
    if audio is None or samples < MINIMUM_SAMPLES:
        raise RuntimeError("Ava generated empty or implausibly short audio")

    duration = samples / sample_rate
    print(
        "Ava real synthesis OK"
        f" · sample_rate={sample_rate}"
        f" · samples={samples}"
        f" · duration={duration:.2f}s"
        " · device=cpu"
    )


if __name__ == "__main__":
    main()
