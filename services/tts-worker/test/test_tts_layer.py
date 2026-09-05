from __future__ import annotations

import os
import shlex
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tts_layer import (  # noqa: E402
    CONTRACT_VERSION,
    MAX_AUDIO_BYTES,
    TTSCommandBuilder,
    TTSError,
    TTSProcessRunner,
    tts_status,
)


def quoted(value: str) -> str:
    return shlex.quote(value) if os.name != "nt" else f'"{value}"'


class TTSLayerTests(unittest.TestCase):
    def make_engine(self, directory: Path, body: str) -> Path:
        script = directory / "engine.py"
        script.write_text(textwrap.dedent(body), encoding="utf-8")
        return script

    def template(self, script: Path) -> str:
        return f"{quoted(sys.executable)} {quoted(str(script))} {quoted('{text_file}')} {quoted('{output_wav}')}"

    def test_status_is_independent_of_other_realtime_components(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            engine = self.make_engine(Path(directory), "pass")
            status = tts_status(shared_secret="tts-test-secret", command_template=self.template(engine))
            self.assertTrue(status["ready"])
            self.assertEqual(status["contractVersion"], CONTRACT_VERSION)
            self.assertEqual(status["independentOf"], ["llm", "whisper", "livekit", "ffmpeg"])

    def test_builder_is_shell_free_and_text_uses_file_placeholder(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = self.make_engine(root, "pass")
            text_file = root / "spoken.txt"
            output = root / "speech.wav"
            text_file.write_text("hello; touch should-never-run", encoding="utf-8")
            command = TTSCommandBuilder(self.template(engine)).build(root, text_file, output)
            self.assertEqual(command[0], str(Path(sys.executable).resolve()))
            self.assertIn(str(text_file), command)
            self.assertNotIn("hello; touch should-never-run", command)

    def test_builder_rejects_unknown_or_missing_placeholders(self) -> None:
        with self.assertRaises(TTSError):
            TTSCommandBuilder(f"{quoted(sys.executable)} {{text_file}}").resolved_executable()
        with self.assertRaises(TTSError):
            TTSCommandBuilder(f"{quoted(sys.executable)} {{text_file}} {{output_wav}} {{voice}}").resolved_executable()

    def test_runner_synthesizes_valid_wav_without_real_engine(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = self.make_engine(
                root,
                """
                import sys, wave
                text = open(sys.argv[1], encoding='utf-8').read()
                assert text == 'سلام test'
                with wave.open(sys.argv[2], 'wb') as out:
                    out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
                    out.writeframes(b'\\x00\\x00' * 160)
                """,
            )
            work_root = root / "work"
            runner = TTSProcessRunner(
                command_template=self.template(engine),
                timeout_seconds=2,
                termination_grace_seconds=0.1,
                work_root=work_root,
            )
            audio = runner.synthesize("سلام test")
            self.assertGreater(len(audio), 44)
            self.assertLessEqual(len(audio), MAX_AUDIO_BYTES)
            self.assertEqual(list(work_root.iterdir()), [])

    def test_runner_times_out_and_cleans_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = self.make_engine(root, "import time; time.sleep(5)")
            work_root = root / "work"
            runner = TTSProcessRunner(
                command_template=self.template(engine),
                timeout_seconds=0.1,
                termination_grace_seconds=0.05,
                work_root=work_root,
            )
            started = time.perf_counter()
            with self.assertRaises(TTSError) as raised:
                runner.synthesize("timeout")
            self.assertEqual(raised.exception.code, "provider_timeout")
            self.assertLess(time.perf_counter() - started, 2)
            self.assertEqual(list(work_root.iterdir()), [])

    def test_runner_rejects_invalid_audio_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = self.make_engine(root, "import sys; open(sys.argv[2], 'wb').write(b'not-wav')")
            runner = TTSProcessRunner(command_template=self.template(engine), timeout_seconds=2)
            with self.assertRaises(TTSError) as raised:
                runner.synthesize("invalid output")
            self.assertEqual(raised.exception.code, "invalid_audio_output")

    def test_runner_maps_nonzero_exit_without_exposing_spoken_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = self.make_engine(root, "import sys; sys.stderr.write('engine failed'); raise SystemExit(7)")
            runner = TTSProcessRunner(command_template=self.template(engine), timeout_seconds=2)
            secret_text = "private candidate words"
            with self.assertRaises(TTSError) as raised:
                runner.synthesize(secret_text)
            self.assertEqual(raised.exception.code, "provider_error")
            self.assertEqual(raised.exception.exit_code, 7)
            self.assertNotIn(secret_text, raised.exception.diagnostic)


if __name__ == "__main__":
    unittest.main()
