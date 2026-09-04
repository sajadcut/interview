from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "contracts" / "realtime-metrics.v1.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
CONTRACT_VERSION = str(CONTRACT["contractVersion"])


@dataclass(frozen=True)
class MetricDefinition:
    name: str
    type: str
    help: str
    labels: dict[str, tuple[str, ...]]
    buckets: tuple[float, ...]


def _definitions() -> dict[str, MetricDefinition]:
    result: dict[str, MetricDefinition] = {}
    for raw in CONTRACT["metrics"]:
        result[str(raw["name"])] = MetricDefinition(
            name=str(raw["name"]),
            type=str(raw["type"]),
            help=str(raw["help"]),
            labels={key: tuple(str(item) for item in values) for key, values in raw.get("labels", {}).items()},
            buckets=tuple(float(item) for item in raw.get("buckets", [])),
        )
    return result


DEFINITIONS = _definitions()


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _label_key(definition: MetricDefinition, labels: dict[str, str]) -> tuple[tuple[str, str], ...]:
    expected = set(definition.labels)
    actual = set(labels)
    if actual != expected:
        raise ValueError(f"{definition.name} requires labels {sorted(expected)}, received {sorted(actual)}")
    normalized: list[tuple[str, str]] = []
    for key in sorted(definition.labels):
        value = str(labels[key])
        allowed = definition.labels[key]
        if value not in allowed:
            raise ValueError(f"{definition.name} label {key} does not allow {value!r}")
        normalized.append((key, value))
    return tuple(normalized)


def _render_labels(labels: tuple[tuple[str, str], ...], extra: tuple[str, str] | None = None) -> str:
    values = list(labels)
    if extra is not None:
        values.append(extra)
    if not values:
        return ""
    return "{" + ",".join(f'{key}="{_escape_label(value)}"' for key, value in values) + "}"


def _format_number(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return format(value, ".12g")


def _format_bucket(value: float) -> str:
    return _format_number(float(value))


class RealtimeMetricsRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._values: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
        self._histograms: dict[
            tuple[str, tuple[tuple[str, str], ...]],
            tuple[list[int], float, int],
        ] = {}

    def increment(self, name: str, amount: float = 1.0, **labels: str) -> None:
        definition = self._definition(name, "counter")
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("counter increment must be a finite non-negative number")
        key = (name, _label_key(definition, labels))
        with self._lock:
            self._values[key] = self._values.get(key, 0.0) + amount

    def set_gauge(self, name: str, value: float, **labels: str) -> None:
        definition = self._definition(name, "gauge")
        if not math.isfinite(value):
            raise ValueError("gauge value must be finite")
        key = (name, _label_key(definition, labels))
        with self._lock:
            self._values[key] = float(value)

    def observe(self, name: str, value: float, **labels: str) -> None:
        definition = self._definition(name, "histogram")
        if not math.isfinite(value) or value < 0:
            raise ValueError("histogram observation must be a finite non-negative number")
        key = (name, _label_key(definition, labels))
        with self._lock:
            current = self._histograms.get(key)
            if current is None:
                bucket_counts = [0 for _ in definition.buckets]
                total = 0.0
                count = 0
            else:
                bucket_counts, total, count = current
                bucket_counts = list(bucket_counts)
            for index, upper_bound in enumerate(definition.buckets):
                if value <= upper_bound:
                    bucket_counts[index] += 1
            self._histograms[key] = (bucket_counts, total + value, count + 1)

    def render(self) -> str:
        lines: list[str] = []
        with self._lock:
            values = dict(self._values)
            histograms = {
                key: (list(bucket_counts), total, count)
                for key, (bucket_counts, total, count) in self._histograms.items()
            }

        observed_names = {name for name, _ in values} | {name for name, _ in histograms}
        for name in sorted(observed_names):
            definition = DEFINITIONS[name]
            lines.extend([f"# HELP {name} {definition.help}", f"# TYPE {name} {definition.type}"])
            for (metric_name, labels), value in sorted(values.items()):
                if metric_name != name:
                    continue
                lines.append(f"{name}{_render_labels(labels)} {_format_number(value)}")
            for (metric_name, labels), (bucket_counts, total, count) in sorted(histograms.items()):
                if metric_name != name:
                    continue
                for upper_bound, bucket_count in zip(definition.buckets, bucket_counts, strict=True):
                    lines.append(
                        f'{name}_bucket{_render_labels(labels, ("le", _format_bucket(upper_bound)))} {bucket_count}'
                    )
                lines.append(f'{name}_bucket{_render_labels(labels, ("le", "+Inf"))} {count}')
                lines.append(f"{name}_sum{_render_labels(labels)} {_format_number(total)}")
                lines.append(f"{name}_count{_render_labels(labels)} {count}")
        return "\n".join(lines) + ("\n" if lines else "")

    @staticmethod
    def _definition(name: str, expected_type: str) -> MetricDefinition:
        definition = DEFINITIONS.get(name)
        if definition is None:
            raise ValueError(f"metric {name!r} is not part of realtime metrics contract {CONTRACT_VERSION}")
        if definition.type != expected_type:
            raise ValueError(f"metric {name!r} is {definition.type}, not {expected_type}")
        return definition


REGISTRY = RealtimeMetricsRegistry()
REGISTRY.set_gauge("interview_realtime_contract_info", 1, version=CONTRACT_VERSION)


def refresh_component_readiness(*, livekit_ready: bool, whisper_ready: bool, ffmpeg_ready: bool) -> None:
    REGISTRY.set_gauge("interview_realtime_component_ready", 1 if livekit_ready else 0, component="livekit")
    REGISTRY.set_gauge("interview_realtime_component_ready", 1 if whisper_ready else 0, component="whisper")
    REGISTRY.set_gauge("interview_realtime_component_ready", 1 if ffmpeg_ready else 0, component="ffmpeg")


def record_livekit_operation(operation: str, result: str, duration_seconds: float) -> None:
    REGISTRY.increment("interview_realtime_livekit_operations_total", operation=operation, result=result)
    REGISTRY.observe("interview_realtime_livekit_operation_duration_seconds", duration_seconds, operation=operation)


def record_livekit_network_sample(
    *,
    media: str,
    direction: str,
    rtt_seconds: float | None = None,
    jitter_seconds: float | None = None,
    packet_loss_ratio: float | None = None,
) -> None:
    if rtt_seconds is not None:
        REGISTRY.observe("interview_realtime_livekit_rtt_seconds", rtt_seconds, media=media, direction=direction)
    if jitter_seconds is not None:
        REGISTRY.observe("interview_realtime_livekit_jitter_seconds", jitter_seconds, media=media, direction=direction)
    if packet_loss_ratio is not None:
        if packet_loss_ratio > 1:
            raise ValueError("packet_loss_ratio must be <= 1")
        REGISTRY.observe(
            "interview_realtime_livekit_packet_loss_ratio",
            packet_loss_ratio,
            media=media,
            direction=direction,
        )


def set_livekit_population(*, state: str | None = None, kind: str | None = None, value: int) -> None:
    if value < 0:
        raise ValueError("population value must be non-negative")
    if (state is None) == (kind is None):
        raise ValueError("provide exactly one of state or kind")
    if state is not None:
        REGISTRY.set_gauge("interview_realtime_livekit_sessions", value, state=state)
    else:
        REGISTRY.set_gauge("interview_realtime_livekit_participants", value, kind=str(kind))


def record_livekit_reconnect(reason: str) -> None:
    REGISTRY.increment("interview_realtime_livekit_reconnects_total", reason=reason)


def record_whisper_request(
    *,
    result: str,
    processing_duration_seconds: float,
    audio_duration_seconds: float | None,
    empty_transcript: bool = False,
    confidence_ratio: float | None = None,
) -> None:
    REGISTRY.increment("interview_realtime_whisper_requests_total", result=result)
    REGISTRY.observe("interview_realtime_whisper_processing_duration_seconds", processing_duration_seconds)
    if audio_duration_seconds is not None and audio_duration_seconds > 0:
        REGISTRY.observe("interview_realtime_whisper_audio_duration_seconds", audio_duration_seconds)
        REGISTRY.observe(
            "interview_realtime_whisper_realtime_factor",
            processing_duration_seconds / audio_duration_seconds,
        )
    if empty_transcript:
        REGISTRY.increment("interview_realtime_whisper_empty_transcripts_total")
    if confidence_ratio is not None:
        if confidence_ratio > 1:
            raise ValueError("confidence_ratio must be <= 1")
        REGISTRY.observe("interview_realtime_whisper_confidence_ratio", confidence_ratio)


def record_ffmpeg_job(
    *,
    operation: str,
    result: str,
    processing_duration_seconds: float,
    input_duration_seconds: float | None = None,
    input_bytes: int | None = None,
    output_bytes: int | None = None,
    decoded_frames: int | None = None,
    encoded_frames: int | None = None,
    dropped_frames: int | None = None,
    duplicated_frames: int | None = None,
    exit_class: str | None = None,
) -> None:
    REGISTRY.increment("interview_realtime_ffmpeg_jobs_total", operation=operation, result=result)
    REGISTRY.observe(
        "interview_realtime_ffmpeg_processing_duration_seconds",
        processing_duration_seconds,
        operation=operation,
    )
    if input_duration_seconds is not None and input_duration_seconds > 0:
        REGISTRY.observe(
            "interview_realtime_ffmpeg_input_duration_seconds",
            input_duration_seconds,
            operation=operation,
        )
        REGISTRY.observe(
            "interview_realtime_ffmpeg_realtime_factor",
            processing_duration_seconds / input_duration_seconds,
            operation=operation,
        )
    for direction, amount in (("input", input_bytes), ("output", output_bytes)):
        if amount is not None:
            REGISTRY.increment(
                "interview_realtime_ffmpeg_bytes_total",
                amount,
                operation=operation,
                direction=direction,
            )
    for outcome, amount in (
        ("decoded", decoded_frames),
        ("encoded", encoded_frames),
        ("dropped", dropped_frames),
        ("duplicated", duplicated_frames),
    ):
        if amount is not None:
            REGISTRY.increment(
                "interview_realtime_ffmpeg_frames_total",
                amount,
                operation=operation,
                outcome=outcome,
            )
    if exit_class is not None:
        REGISTRY.increment(
            "interview_realtime_ffmpeg_process_exits_total",
            operation=operation,
            exit_class=exit_class,
        )


def set_ffmpeg_active_processes(operation: str, value: int) -> None:
    if value < 0:
        raise ValueError("active process count must be non-negative")
    REGISTRY.set_gauge("interview_realtime_ffmpeg_active_processes", value, operation=operation)


def record_turn_stage(stage: str, duration_seconds: float) -> None:
    REGISTRY.observe("interview_realtime_turn_duration_seconds", duration_seconds, stage=stage)


def record_turn_result(result: str) -> None:
    REGISTRY.increment("interview_realtime_turns_total", result=result)
