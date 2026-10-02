import { describe, expect, it } from "vitest";
import { createFaceContactAnnotationTemplate, evaluateFaceContactPredictions, faceRecordingHash, measureCapturedFaceSkin, parseFaceContactAnnotations } from "./faceContactEvaluation";
import { createSyntheticMotionRecording } from "./syntheticMotionRecording";
import type { FaceContactAnnotations } from "./faceContactEvaluation";

const labels:FaceContactAnnotations={version:1,kind:"veiltalk-face-contact-labels",recordingSha256:"a".repeat(64),subjectId:"s1",sessionId:"v1",split:"test",windows:[{side:"left",startMs:0,endMs:100,contact:true,region:"leftCheek",probe:"palmCenter",certainty:"verified"},{side:"left",startMs:100,endMs:200,contact:false,region:null,probe:null,certainty:"verified"}]};
describe("face-contact evaluation contracts",()=>{
  it("keeps abstentions visible and does not score unlabelled time as negatives",()=>{
    const metrics=evaluateFaceContactPredictions([{atMs:0,side:"left",contact:true,region:"leftCheek",probe:"palmCenter"},{atMs:50,side:"left",contact:null,region:null,probe:null},{atMs:120,side:"left",contact:false,region:null,probe:null},{atMs:300,side:"left",contact:true,region:"leftCheek",probe:"palmCenter"}],labels);
    expect(metrics.labelledFrames).toBe(3);expect(metrics.abstainedFrames).toBe(1);expect(metrics.classifiedCoverage).toBeCloseTo(2/3);
    expect(metrics.selectiveRecall).toBe(1);expect(metrics.recallIncludingAbstentions).toBe(.5);expect(metrics.regionClassification.perClass[0].fn).toBe(1);
    expect(evaluateFaceContactPredictions([],null).macroF1).toBeNull();
  });
  it("matches contact events one-to-one and reports onset separately",()=>{
    const predictions=[0,20,40,60,80,100,120].map(atMs=>({atMs,side:"left" as const,contact:atMs<100,region:"leftCheek",probe:"palmCenter"}));
    const result=evaluateFaceContactPredictions(predictions,labels);expect(result.events.tp).toBe(1);expect(result.events.fn).toBe(0);expect(result.events.onsetErrorsMs).toEqual([0]);
  });
  it("rejects overlapping, malformed and reversed annotation windows",()=>{
    expect(parseFaceContactAnnotations(JSON.stringify(labels))).toEqual(labels);
    expect(()=>parseFaceContactAnnotations(JSON.stringify({...labels,windows:[...labels.windows,{...labels.windows[0],startMs:50}]}))).toThrow();
    expect(()=>parseFaceContactAnnotations(JSON.stringify({...labels,windows:[{...labels.windows[0],endMs:-1}]}))).toThrow();
    expect(()=>parseFaceContactAnnotations(JSON.stringify({...labels,recordingSha256:"incorrect"}))).toThrow();
  });
  it("binds template labels to a stable hash and defaults to uncertain",async()=>{
    const recording=createSyntheticMotionRecording("face-cheek",{},3),template=await createFaceContactAnnotationTemplate(recording);
    expect(template.recordingSha256).toBe(await faceRecordingHash(structuredClone(recording)));expect(template.windows.every(w=>w.contact===null&&w.certainty==="uncertain")).toBe(true);
    recording.scene="face-forehead";expect(await faceRecordingHash(recording)).not.toBe(template.recordingSha256);
  });
  it("aligns final skin by packet sequence, skips duplicates and rejects unmatched renders",()=>{
    const recording=createSyntheticMotionRecording("face-cheek",{},3);
    recording.frames[0].packet={sequence:11} as never;recording.frames[1].packet={sequence:12} as never;
    const snapshot=(sequence:number)=>({sequence,contacts:{faceSkin:{sequence,contacts:{left:{gapFaceHeights:.03,normalDegrees:12,localPenetration:.001}}}}});
    recording.frames[0].finalPose=snapshot(11);recording.frames[1].finalPose=snapshot(11);recording.frames[2].finalPose=snapshot(99);
    const report=measureCapturedFaceSkin(recording);expect(report.samples).toBe(1);expect(report.unmatchedSequences).toBe(1);expect(report.gapFaceHeightP95).toBe(.03);
  });
});
