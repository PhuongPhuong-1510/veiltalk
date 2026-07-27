export class CameraPermissionError extends Error {}
export class CameraUnavailableError extends Error {}
export type CameraResolution = "720p" | "480p";

export class CameraController {
  private readonly resolution: CameraResolution;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private endedHandler: (() => void) | null = null;

  constructor(resolution: CameraResolution = "720p") { this.resolution = resolution; }

  get settings(): MediaTrackSettings | null {
    return this.stream?.getVideoTracks()[0]?.getSettings?.() ?? null;
  }

  async start(video: HTMLVideoElement, onEnded: () => void): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraUnavailableError("Trình duyệt không hỗ trợ webcam.");
    try {
      const dimensions = this.resolution === "720p" ? { width: 1280, height: 720 } : { width: 640, height: 480 };
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: dimensions.width }, height: { ideal: dimensions.height }, frameRate: { ideal: 30 } },
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        throw new CameraPermissionError("Quyền truy cập webcam bị từ chối.");
      }
      throw new CameraUnavailableError("Không thể mở webcam.", { cause: error });
    }
    this.video = video;
    this.endedHandler = onEnded;
    for (const track of this.stream.getVideoTracks()) track.addEventListener("ended", onEnded, { once: true });
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
  }

  stop(): void {
    if (this.stream && this.endedHandler) {
      for (const track of this.stream.getVideoTracks()) track.removeEventListener("ended", this.endedHandler);
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.stream = null;
    this.video = null;
    this.endedHandler = null;
  }
}
