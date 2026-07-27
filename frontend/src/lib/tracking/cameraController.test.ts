import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraController, CameraPermissionError, CameraUnavailableError } from "./cameraController";

afterEach(() => vi.unstubAllGlobals());

function fakeVideo() {
  return { srcObject: null, muted: false, playsInline: false, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() } as unknown as HTMLVideoElement;
}

describe("CameraController", () => {
  it("maps permission denial to a stable error", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) } });
    await expect(new CameraController().start(fakeVideo(), vi.fn())).rejects.toBeInstanceOf(CameraPermissionError);
  });

  it("reports unsupported camera API", async () => {
    vi.stubGlobal("navigator", {});
    await expect(new CameraController().start(fakeVideo(), vi.fn())).rejects.toBeInstanceOf(CameraUnavailableError);
  });

  it("stops tracks, removes listener and clears video without disposing models", async () => {
    const track = { addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
    const video = fakeVideo(); const ended = vi.fn(); const camera = new CameraController();
    await camera.start(video, ended);
    expect(video.srcObject).toBe(stream);
    camera.stop();
    camera.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.removeEventListener).toHaveBeenCalledWith("ended", ended);
    expect(video.srcObject).toBeNull();
  });

  it("requests the controlled 480p benchmark constraints", async () => {
    const track = { addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const camera = new CameraController("480p");
    await camera.start(fakeVideo(), vi.fn());
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
    camera.stop();
  });
});
