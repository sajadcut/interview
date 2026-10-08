import assert from "node:assert/strict";
import test from "node:test";
import { CandidateDevicePreview } from "./candidate-device-preview";

type MockTrack = {
  readyState: "live" | "ended";
  stopped: boolean;
  stop(): void;
};

function makeTrack(): MockTrack {
  return {
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
}

function makeStream(audio: boolean) {
  const track = makeTrack();
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => audio ? [track] : [],
      getVideoTracks: () => audio ? [] : [track],
    } as unknown as MediaStream,
  };
}

function devices(getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>): Pick<MediaDevices, "getUserMedia"> {
  return { getUserMedia } as Pick<MediaDevices, "getUserMedia">;
}

test("candidate preview keeps microphone and camera running until explicit stop", async () => {
  const microphone = makeStream(true);
  const camera = makeStream(false);
  const preview = new CandidateDevicePreview(devices(async (constraints) =>
    constraints.video ? camera.stream : microphone.stream,
  ));

  const result = await preview.start();
  assert.equal(result?.microphone, microphone.stream);
  assert.equal(result?.camera, camera.stream);
  assert.equal(result?.cameraError, null);
  assert.equal(microphone.track.stopped, false);
  assert.equal(camera.track.stopped, false);

  preview.stop();
  assert.equal(microphone.track.stopped, true);
  assert.equal(camera.track.stopped, true);
});

test("missing camera keeps a working microphone live for audio-only mode", async () => {
  const microphone = makeStream(true);
  const preview = new CandidateDevicePreview(devices(async (constraints) => {
    if (constraints.video) throw new Error("camera busy");
    return microphone.stream;
  }));

  const result = await preview.start();
  assert.equal(result?.microphone, microphone.stream);
  assert.equal(result?.camera, null);
  assert.match(String(result?.cameraError), /camera busy/);
  assert.equal(microphone.track.stopped, false);
  preview.stop();
  assert.equal(microphone.track.stopped, true);
});

test("microphone failure blocks readiness instead of silently falling back", async () => {
  const preview = new CandidateDevicePreview(devices(async () => { throw new Error("microphone blocked"); }));
  await assert.rejects(() => preview.start(), /microphone blocked/);
});

test("recheck closes previous preview before opening the next devices", async () => {
  const firstMic = makeStream(true);
  const firstCam = makeStream(false);
  const nextMic = makeStream(true);
  const nextCam = makeStream(false);
  let calls = 0;
  const preview = new CandidateDevicePreview(devices(async () => {
    const result = [firstMic.stream, firstCam.stream, nextMic.stream, nextCam.stream][calls];
    calls += 1;
    if (!result) throw new Error("unexpected media request");
    return result;
  }));

  assert.ok(await preview.start());
  assert.ok(await preview.start());
  assert.equal(firstMic.track.stopped, true);
  assert.equal(firstCam.track.stopped, true);
  assert.equal(nextMic.track.stopped, false);
  assert.equal(nextCam.track.stopped, false);
  preview.stop();
});

test("unmount while camera permission is pending cannot reactivate a late camera", async () => {
  const mic = makeStream(true);
  const cam = makeStream(false);
  let resolveCamera: (stream: MediaStream) => void = () => { throw new Error("not initialized"); };
  const cameraPending = new Promise<MediaStream>((resolve) => { resolveCamera = resolve; });
  const preview = new CandidateDevicePreview(devices(async (constraints) =>
    constraints.video ? cameraPending : mic.stream,
  ));

  const checking = preview.start();
  await Promise.resolve();
  preview.stop();
  resolveCamera(cam.stream);
  assert.equal(await checking, null);
  assert.equal(mic.track.stopped, true);
  assert.equal(cam.track.stopped, true);
});

test("unmount during pending microphone permission closes the late microphone", async () => {
  const mic = makeStream(true);
  let resolveMicrophone: (stream: MediaStream) => void = () => { throw new Error("not initialized"); };
  const pendingMicrophone = new Promise<MediaStream>((resolve) => { resolveMicrophone = resolve; });
  const preview = new CandidateDevicePreview(devices(async () => pendingMicrophone));
  const checking = preview.start();
  preview.stop();
  resolveMicrophone(mic.stream);
  assert.equal(await checking, null);
  assert.equal(mic.track.stopped, true);
});

test("busy camera is retried without stopping the working microphone", async () => {
  const microphone = makeStream(true);
  const camera = makeStream(false);
  let cameraCalls = 0;
  const preview = new CandidateDevicePreview(devices(async (constraints) => {
    if (!constraints.video) return microphone.stream;
    cameraCalls += 1;
    if (cameraCalls === 1) throw new DOMException("camera temporarily busy", "NotReadableError");
    return camera.stream;
  }));
  const result = await preview.start({ cameraRetryDelaysMs: [1] });
  assert.equal(result?.camera, camera.stream);
  assert.equal(result?.cameraError, null);
  assert.equal(cameraCalls, 2);
  assert.equal(microphone.track.stopped, false);
  assert.equal(camera.track.stopped, false);
  preview.stop();
  assert.equal(microphone.track.stopped, true);
  assert.equal(camera.track.stopped, true);
});

test("audio-only request never opens the camera", async () => {
  const microphone = makeStream(true);
  let cameraCalls = 0;
  const preview = new CandidateDevicePreview(devices(async (constraints) => {
    if (constraints.video) { cameraCalls += 1; throw new Error("should not request camera"); }
    return microphone.stream;
  }));
  const result = await preview.start({ video: false });
  assert.equal(result?.microphone, microphone.stream);
  assert.equal(result?.camera, null);
  assert.equal(result?.cameraError, null);
  assert.equal(cameraCalls, 0);
  preview.stop();
});
