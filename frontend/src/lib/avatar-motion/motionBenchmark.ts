import { AvatarMotionProcessor, type AvatarMotionProcessorOptions } from "./avatarMotionProcessor";
import type { AvatarPosePacket } from "./avatarPoseTypes";
import type { FingerRigProfile } from "./fingerRig";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import { rotationStepDegrees, type MotionRecordingV1 } from "./motionReplay";

const p95 = (values: number[]): number | null => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1] : null;
export interface MotionBenchmarkResult {
  name: string; frames: number; durationMs: number; processorP95Ms: number | null;
  measuredStage: "processor-packet"; staticScene: boolean;
  /** Step RMS is jitter only in a static scene after warmup, never a fidelity/accuracy score. */
  rotationStepRmsDegrees: Record<string, number>;
  reconstructionAccepted: number; reconstructionRejected: number; nonFiniteRotations: number;
  limitations: string[];
}

export function benchmarkMotionRecording(recording: MotionRecordingV1, name: string, options: AvatarMotionProcessorOptions): MotionBenchmarkResult {
  let clock = recording.frames[0].atMs;
  const processor = new AvatarMotionProcessor({ ...options, now: () => clock });
  const rig = recording.metadata.rigProfile as NormalizedAvatarRigProfile | null;
  if (!rig) throw new Error("Replay chưa có rig: hãy chờ avatar tải xong trước khi thu.");
  processor.setRigProfile(rig);
  processor.setUpperBodyRigProfile(recording.metadata.upperBodyRigProfile as UpperBodyRigProfileV1 | null ?? null);
  processor.setFingerRig(recording.metadata.fingerRig as FingerRigProfile | null ?? null);
  processor.setContactShadowEnabled(true);
  // Contact remains off in baseline comparisons, even when it was enabled during capture.
  processor.setContactCorrectionEnabled(false);
  const timings: number[] = [], squaredSteps: Record<string, { sum: number; count: number }> = {};
  let previous: AvatarPosePacket | null = null, accepted = 0, rejected = 0, nonFinite = 0;
  try {
    recording.frames.forEach((entry, index) => {
      clock = entry.atMs;
      const before = performance.now(), packet = processor.process(entry.raw);
      timings.push(performance.now() - before);
      for (const [joint, q] of Object.entries(packet.jointRotations)) {
        if (!q || ![q.x,q.y,q.z,q.w].every(Number.isFinite)) { nonFinite++; continue; }
        const prior = previous?.jointRotations[joint as keyof typeof previous.jointRotations];
        // Exclude acquire transient, and only compare fresh targets at distinct Pose/Hand times.
        const newObservation = previous && (packet.tracking.pose.sampledAtMs !== previous.tracking.pose.sampledAtMs || entry.raw.handSampledThisFrame);
        const step = prior && index >= 30 && newObservation ? rotationStepDegrees(prior, q) : null;
        if (step !== null) { const state = squaredSteps[joint] ??= { sum: 0, count: 0 }; state.sum += step * step; state.count++; }
      }
      const diagnostic = processor.getLastDiagnostics();
      for (const side of ["left","right"] as const) {
        const wrist = diagnostic?.arms[side].wristEvidence;
        if (wrist?.source === "hand-image") { if (wrist.reconstructionConfidence !== null) accepted++; else rejected++; }
      }
      previous = packet;
    });
  } finally { processor.dispose(); }
  return { name, frames: recording.frames.length, durationMs: recording.frames.at(-1)!.atMs - recording.frames[0].atMs,
    processorP95Ms: p95(timings), measuredStage: "processor-packet", staticScene: recording.scene === "static",
    rotationStepRmsDegrees: Object.fromEntries(Object.entries(squaredSteps).map(([joint, state]) => [joint, Math.sqrt(state.sum/state.count)])),
    reconstructionAccepted: accepted, reconstructionRejected: rejected, nonFiniteRotations: nonFinite,
    limitations: ["Không bao gồm detector, renderer damping, final skin FK hoặc webcam ground truth.", "Step RMS chỉ biểu thị rung khi scene thực sự đứng yên; không dùng để chọn nghiệm ít chuyển động nhưng sai pose.", "Processor timing trong replay chưa phải latency đầu–cuối hoặc benchmark XR.", "Calibration/neutral cần thu đủ đoạn đầu; replay reset state không khôi phục state trước recording."] };
}

export function compareMotionRecording(recording: MotionRecordingV1): MotionBenchmarkResult[] {
  const base = { filtered: true, constraints: true, continuousFingerEnabled: true, handTwistEnabled: true };
  return [benchmarkMotionRecording(recording, "baseline", base), benchmarkMotionRecording(recording, "wrist-relative-shape", { ...base, handConditioningEnabled: true }), benchmarkMotionRecording(recording, "rig-aware-endpoint", { ...base, rigEndpointEnabled: true })];
}
