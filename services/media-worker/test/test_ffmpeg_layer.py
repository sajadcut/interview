from __future__ import annotations

import sys
import threading
import time
import unittest
from pathlib import Path

MEDIA_WORKER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MEDIA_WORKER_ROOT))

from ffmpeg_layer import (  # noqa: E402
    DIAGNOSTIC_MAX_BYTES,
    FFmpegCommandBuilder,
    FFmpegError,
    FFmpegJobSpec,
    FFmpegProcessRunner,
    FFmpegWorkspace,
    ffmpeg_status,
)


class FFmpegLayerTests(unittest.TestCase):
    def test_readiness_is_fail_closed_when_disabled(self) -> None:
        status = ffmpeg_status(enabled=False, executable=sys.executable)
        self.assertFalse(status["ready"])
        self.assertEqual(status["reason"], "disabled")
        self.assertEqual(status["contractVersion"], "ffmpeg-integration.v1")

    def test_readiness_accepts_explicit_executable_without_ffmpeg(self) -> None:
        status = ffmpeg_status(enabled=True, executable=sys.executable)
        self.assertTrue(status["ready"])
        self.assertEqual(status["provider"], "ffmpeg")

    def test_command_builder_is_shell_free_and_uses_fixed_ingest_profile(self) -> None:
        with FFmpegWorkspace() as workspace:
            source = workspace.write_bytes("input.bin", b"source")
            output = workspace.path("normalized.wav")
            spec = FFmpegJobSpec("ingest", workspace.root, (source,), output)
            command = FFmpegCommandBuilder("ffmpeg-not-required").build(spec)
            self.assertEqual(command[0], "ffmpeg-not-required")
            self.assertIn("-nostdin", command)
            self.assertIn("pcm_s16le", command)
            self.assertEqual(command[-1], str(output))

    def test_command_builder_rejects_workspace_escape(self) -> None:
        with FFmpegWorkspace() as workspace:
            source = workspace.write_bytes("input.bin", b"source")
            with self.assertRaises(FFmpegError) as raised:
                FFmpegCommandBuilder().build(
                    FFmpegJobSpec(
                        "ingest",
                        workspace.root,
                        (source,),
                        workspace.root.parent / "escape.wav",
                    )
                )
            self.assertEqual(raised.exception.code, "invalid_request")

    def test_segment_requires_bounded_duration_and_numeric_output_pattern(self) -> None:
        with FFmpegWorkspace() as workspace:
            source = workspace.write_bytes("input.mkv", b"source")
            output = workspace.path("segment-%05d.mkv")
            command = FFmpegCommandBuilder().build(
                FFmpegJobSpec("segment", workspace.root, (source,), output, segment_seconds=2.5)
            )
            self.assertIn("-segment_time", command)
            self.assertIn("2.5", command)
            with self.assertRaises(FFmpegError):
                FFmpegCommandBuilder().build(
                    FFmpegJobSpec(
                        "segment",
                        workspace.root,
                        (source,),
                        workspace.path("segment.mkv"),
                        segment_seconds=2.5,
                    )
                )

    def test_workspace_cleanup_runs_after_success(self) -> None:
        workspace = FFmpegWorkspace()
        root = workspace.root
        workspace.write_bytes("nested/input.bin", b"x")
        workspace.cleanup()
        self.assertFalse(root.exists())

    def test_runner_success_uses_python_fake_process_without_ffmpeg(self) -> None:
        with FFmpegWorkspace() as workspace:
            source = workspace.write_bytes("input.bin", b"abc")
            output = workspace.path("output.bin")
            runner = FFmpegProcessRunner(timeout_seconds=2, termination_grace_seconds=0.1)
            result = runner.run_command(
                (
                    sys.executable,
                    "-S",
                    "-c",
                    "from pathlib import Path; import sys; Path(sys.argv[1]).write_bytes(b'output')",
                    str(output),
                ),
                operation="transcode",
                workspace=workspace.root,
                expected_output=lambda: (output,),
                input_paths=(source,),
            )
            self.assertEqual(result.exit_code, 0)
            self.assertEqual(result.input_bytes, 3)
            self.assertEqual(result.output_bytes, 6)

    def test_runner_maps_nonzero_exit_and_sanitizes_workspace_path(self) -> None:
        with FFmpegWorkspace() as workspace:
            output = workspace.path("output.bin")
            runner = FFmpegProcessRunner(timeout_seconds=2, termination_grace_seconds=0.1)
            with self.assertRaises(FFmpegError) as raised:
                runner.run_command(
                    (
                        sys.executable,
                        "-S",
                        "-c",
                        "import sys; sys.stderr.write(sys.argv[1] + ' provider failed'); raise SystemExit(7)",
                        str(workspace.root),
                    ),
                    operation="mux",
                    workspace=workspace.root,
                    expected_output=lambda: (output,),
                )
            self.assertEqual(raised.exception.code, "process_failed")
            self.assertEqual(raised.exception.exit_code, 7)
            self.assertIn("<workspace>", raised.exception.diagnostic)
            self.assertNotIn(str(workspace.root), raised.exception.diagnostic)

    def test_runner_times_out_and_kills_process(self) -> None:
        with FFmpegWorkspace() as workspace:
            runner = FFmpegProcessRunner(timeout_seconds=0.1, termination_grace_seconds=0.05)
            started = time.perf_counter()
            with self.assertRaises(FFmpegError) as raised:
                runner.run_command(
                    (sys.executable, "-S", "-c", "import time; time.sleep(5)"),
                    operation="recording_finalize",
                    workspace=workspace.root,
                    expected_output=lambda: (),
                )
            self.assertEqual(raised.exception.code, "process_timeout")
            self.assertTrue(raised.exception.retryable)
            self.assertLess(time.perf_counter() - started, 2)

    def test_runner_cancels_inflight_process(self) -> None:
        with FFmpegWorkspace() as workspace:
            runner = FFmpegProcessRunner(timeout_seconds=2, termination_grace_seconds=0.05)
            cancel = threading.Event()
            timer = threading.Timer(0.05, cancel.set)
            timer.start()
            try:
                with self.assertRaises(FFmpegError) as raised:
                    runner.run_command(
                        (sys.executable, "-S", "-c", "import time; time.sleep(5)"),
                        operation="ingest",
                        workspace=workspace.root,
                        expected_output=lambda: (),
                        cancel_event=cancel,
                    )
            finally:
                timer.cancel()
            self.assertEqual(raised.exception.code, "process_cancelled")

    def test_runner_rejects_missing_and_empty_outputs(self) -> None:
        with FFmpegWorkspace() as workspace:
            runner = FFmpegProcessRunner(timeout_seconds=2, termination_grace_seconds=0.1)
            missing_output = workspace.path("missing.bin")
            with self.assertRaises(FFmpegError) as missing:
                runner.run_command(
                    (sys.executable, "-S", "-c", "pass"),
                    operation="transcode",
                    workspace=workspace.root,
                    expected_output=lambda: (missing_output,),
                )
            self.assertEqual(missing.exception.code, "output_missing")

            empty_output = workspace.path("empty.bin")
            with self.assertRaises(FFmpegError) as empty:
                runner.run_command(
                    (
                        sys.executable,
                        "-S",
                        "-c",
                        "from pathlib import Path; import sys; Path(sys.argv[1]).touch()",
                        str(empty_output),
                    ),
                    operation="transcode",
                    workspace=workspace.root,
                    expected_output=lambda: (empty_output,),
                )
            self.assertEqual(empty.exception.code, "output_empty")

    def test_diagnostic_is_bounded(self) -> None:
        with FFmpegWorkspace() as workspace:
            runner = FFmpegProcessRunner(timeout_seconds=2, termination_grace_seconds=0.1)
            with self.assertRaises(FFmpegError) as raised:
                runner.run_command(
                    (
                        sys.executable,
                        "-S",
                        "-c",
                        "import sys; sys.stderr.write('x' * 50000); raise SystemExit(2)",
                    ),
                    operation="segment",
                    workspace=workspace.root,
                    expected_output=lambda: (),
                )
            self.assertLessEqual(
                len(raised.exception.diagnostic.encode("utf-8")),
                DIAGNOSTIC_MAX_BYTES,
            )


if __name__ == "__main__":
    unittest.main()
