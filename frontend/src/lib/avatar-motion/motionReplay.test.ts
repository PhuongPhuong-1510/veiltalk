import { describe, expect, it } from "vitest";
import { parseMotionRecording, rebaseTrackingFrame, rotationStepDegrees, type MotionRecordingV1 } from "./motionReplay";
import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";

const raw = (): RawTrackingFrameV1 => ({version:1,frameTimestampMs:100,overall:"lost",videoWidth:1280,videoHeight:720,
  face:{state:"lost",sampledAtMs:90,landmarks:null,blendshapes:null,facialTransform:null},
  pose:{state:"lost",sampledAtMs:95,landmarks:null,worldLandmarks:null},
  leftHand:{state:"lost",sampledAtMs:80,landmarks:null,worldLandmarks:null,handedness:"left",handednessScore:null},
  rightHand:{state:"not-sampled",sampledAtMs:null,landmarks:null,worldLandmarks:null,handedness:"right",handednessScore:null},
  rawHands:[],handSampledThisFrame:false,handSampledAtMs:80});
const recording = (): MotionRecordingV1 => ({version:1,kind:"veiltalk-motion-replay",scene:"static",createdAt:"test",metadata:{},frames:[{atMs:110,raw:raw()}]});

describe("motion replay contract", () => {
  it("preserves sample ages, nulls and source data when changing the render clock", () => {
    const input=raw(),copy=structuredClone(input),next=rebaseTrackingFrame(input,1000);
    expect(next.frameTimestampMs-next.pose.sampledAtMs!).toBe(5);
    expect(next.face.sampledAtMs).toBe(1090);expect(next.rightHand.sampledAtMs).toBeNull();
    expect(next.handSampledAtMs).toBe(1080);expect(input).toEqual(copy);
  });
  it("validates all frames and rejects descending arrival time or missing raw payloads", () => {
    expect(parseMotionRecording(JSON.stringify(recording())).frames).toHaveLength(1);
    const bad=recording();bad.frames.push({atMs:50,raw:raw()});expect(()=>parseMotionRecording(JSON.stringify(bad))).toThrow();
    const malformed=recording();malformed.frames[0].raw.pose.worldLandmarks=[{x:NaN,y:0,z:0,visibility:1}];
    expect(()=>parseMotionRecording(JSON.stringify(malformed))).toThrow();
    expect(()=>parseMotionRecording(JSON.stringify({frames:[]}))).toThrow();
  });
  it("does not confuse quaternion sign changes with motion", () => {
    expect(rotationStepDegrees({x:0,y:0,z:0,w:1},{x:0,y:0,z:0,w:-1})).toBe(0);
    expect(rotationStepDegrees({x:0,y:0,z:0,w:0},{x:0,y:0,z:0,w:1})).toBeNull();
  });
});
