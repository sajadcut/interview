/**
 * Owns the temporary local camera/microphone preview during candidate setup.
 * Unlike a one-shot permission probe, tracks stay live until stop() or navigation.
 * Concurrent/stale requests never resurrect streams after they were released.
 */
export const CANDIDATE_PREVIEW_HANDOFF_KEY = "candidate:media-preview-handoff";

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
        if (delays[attempt] > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
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
          } else {
            stopTracks(candidate);
            cameraError = new Error("camera_unavailable");
          }
          break;
        } catch (cause) {
          if (request !== this.generation) return null;
          cameraError = cause;
          const transient = cause instanceof DOMException && ["NotReadableError", "AbortError"].includes(cause.name);
          if (!transient) break;
        }
      }
    }

    return { microphone, camera, cameraError };
  }
}
