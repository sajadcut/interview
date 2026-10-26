/**
 * Owns the temporary local camera/microphone preview during candidate setup.
 * Unlike a one-shot permission probe, tracks stay live until stop() or navigation.
 * Concurrent/stale requests never resurrect streams after they were released.
 */
export const CANDIDATE_PREVIEW_HANDOFF_KEY = "candidate:media-preview-handoff";

export type CandidatePreviewHandoffMode = "full" | "audio-only";

/** Preserve the candidate's explicit setup choice through the same-tab navigation. */
export function candidatePreviewHandoffValue(audioOnly: boolean): CandidatePreviewHandoffMode {
  return audioOnly ? "audio-only" : "full";
}

/** Old "1" markers are accepted for a one-time backwards-compatible full-media handoff. */
export function parseCandidatePreviewHandoff(value: string | null): CandidatePreviewHandoffMode | null {
  if (value === "audio-only") return "audio-only";
  if (value === "full" || value === "1") return "full";
  return null;
}

export interface CandidateDevicePreviewOptions {
  audio?: boolean | MediaTrackConstraints;
  video?: boolean | MediaTrackConstraints;
  cameraRetryDelaysMs?: number[];
  microphoneRetryDelaysMs?: number[];
}

export interface CandidateDevicePreviewResult {
  microphone: MediaStream;
  camera: MediaStream | null;
  cameraError: unknown | null;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export class CandidateDevicePreview {
  private generation = 0;
  private streams = new Set<MediaStream>();

  constructor(private readonly devices: Pick<MediaDevices, "getUserMedia">) {}

  private release(): void {
    for (const stream of this.streams) stopTracks(stream);
    this.streams.clear();
  }

  stop(): void {
    this.generation += 1;
    this.release();
  }

  hasLiveMicrophone(): boolean {
    return [...this.streams].some((stream) =>
      stream.getAudioTracks().some((track) => track.readyState === "live"),
    );
  }

  hasLiveCamera(): boolean {
    return [...this.streams].some((stream) =>
      stream.getVideoTracks().some((track) => track.readyState === "live"),
    );
  }

  async start(options: CandidateDevicePreviewOptions = {}): Promise<CandidateDevicePreviewResult | null> {
    const request = ++this.generation;
    this.release();

    let microphone: MediaStream | null = null;
    let microphoneError: unknown = null;
    const microphoneDelays = [0, ...(options.microphoneRetryDelaysMs ?? [])];
    for (const delay of microphoneDelays) {
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        if (request !== this.generation) return null;
      }
      try {
        const candidate = await this.devices.getUserMedia({ audio: options.audio ?? true, video: false });
        if (request !== this.generation) {
          stopTracks(candidate);
          return null;
        }
        microphone = candidate;
        break;
      } catch (cause) {
        if (request !== this.generation) return null;
        microphoneError = cause;
        const transient = cause instanceof DOMException && ["NotReadableError", "AbortError"].includes(cause.name);
        if (!transient) break;
      }
    }
    if (!microphone) throw microphoneError ?? new Error("microphone_unavailable");
    if (!microphone.getAudioTracks().some((track) => track.readyState === "live")) {
      stopTracks(microphone);
      throw new Error("microphone_unavailable");
    }
    this.streams.add(microphone);

    let camera: MediaStream | null = null;
    let cameraError: unknown | null = null;
    if (options.video !== false) {
      const delays = [0, ...(options.cameraRetryDelaysMs ?? [])];
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        const delay = delays[attempt] ?? 0;
        if (delay > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          if (request !== this.generation) return null;
        }
        try {
          const candidate = await this.devices.getUserMedia({ audio: false, video: options.video ?? true });
          if (request !== this.generation) {
            stopTracks(candidate);
            return null;
          }
          if (candidate.getVideoTracks().some((track) => track.readyState === "live")) {
            camera = candidate;
            this.streams.add(candidate);
            cameraError = null;
            break;
          }
          // A browser can resolve getUserMedia with a track already ended.
          // Retry within the same bounded policy instead of reporting it ready.
          stopTracks(candidate);
          cameraError = new Error("camera_unavailable");
        } catch (cause) {
          if (request !== this.generation) return null;
          cameraError = cause;
          const transient = cause instanceof DOMException && ["NotReadableError", "AbortError"].includes(cause.name);
          if (!transient) break;
        }
      }
    }

    // Camera permission/retry delays can outlast a previously live microphone.
    // Check again at the point readiness is returned, not just after acquisition.
    if (!this.hasLiveMicrophone()) {
      this.release();
      throw new Error("microphone_unavailable");
    }
    if (camera && !this.hasLiveCamera()) {
      stopTracks(camera);
      this.streams.delete(camera);
      camera = null;
      cameraError = new Error("camera_unavailable");
    }
    return { microphone, camera, cameraError };
  }
}
