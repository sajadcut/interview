/**
 * Owns the temporary local camera/microphone preview during candidate setup.
 * Unlike a one-shot permission probe, tracks stay live until stop() or navigation.
 * Concurrent/stale requests never resurrect streams after they were released.
 */
export const CANDIDATE_PREVIEW_HANDOFF_KEY = "candidate:media-preview-handoff";

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

  async start(): Promise<CandidateDevicePreviewResult | null> {
    const request = ++this.generation;
    this.release();

    let microphone: MediaStream;
    try {
      microphone = await this.devices.getUserMedia({ audio: true, video: false });
    } catch (cause) {
      if (request !== this.generation) return null;
      throw cause;
    }
    if (request !== this.generation) {
      stopTracks(microphone);
      return null;
    }
    if (!microphone.getAudioTracks().some((track) => track.readyState === "live")) {
      stopTracks(microphone);
      throw new Error("microphone_unavailable");
    }
    this.streams.add(microphone);

    let camera: MediaStream | null = null;
    let cameraError: unknown | null = null;
    try {
      const candidate = await this.devices.getUserMedia({ audio: false, video: true });
      if (request !== this.generation) {
        stopTracks(candidate);
        return null;
      }
      if (candidate.getVideoTracks().some((track) => track.readyState === "live")) {
        camera = candidate;
        this.streams.add(candidate);
      } else {
        stopTracks(candidate);
        cameraError = new Error("camera_unavailable");
      }
    } catch (cause) {
      if (request !== this.generation) return null;
      cameraError = cause;
    }

    return { microphone, camera, cameraError };
  }
}
