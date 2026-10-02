import { AvatarMotionProcessor } from "./avatarMotionProcessor";
import { FACE_CONTACT_ABLATIONS, FACE_CONTACT_EXPERIMENT_VERSION, type FaceContactResearchOptions } from "./faceContactResearch";
import type { MotionRecordingV1 } from "./motionReplay";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import type { FingerRigProfile } from "./fingerRig";
import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import type { ContactRuntimeDiagnostic } from "./contactRuntime";

export interface FaceContactLabel {
  side: "left" | "right"; startMs: number; endMs: number;
  contact: boolean | null; region: string | null; probe: string | null;
  certainty: "verified" | "uncertain";
}
export interface FaceContactAnnotations {
  version: 1; kind: "veiltalk-face-contact-labels"; recordingSha256: string;
  subjectId: string; sessionId: string; split: "train" | "validation" | "test";
  windows: FaceContactLabel[];
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export async function faceRecordingHash(value: MotionRecordingV1): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
export function parseFaceContactAnnotations(json: string): FaceContactAnnotations {
  if (json.length > 1_000_000) throw new Error("Nhãn vượt 1 MB.");
  const v: unknown = JSON.parse(json);
  if (!record(v) || v.version !== 1 || v.kind !== "veiltalk-face-contact-labels" || typeof v.recordingSha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.recordingSha256)
    || ![v.subjectId, v.sessionId].every(s => typeof s === "string" && s.length > 0 && s.length <= 128)
    || !["train", "validation", "test"].includes(String(v.split)) || !Array.isArray(v.windows) || v.windows.length > 4000) throw new Error("Định dạng nhãn không hợp lệ.");
  const ends = { left: -Infinity, right: -Infinity };
  for (const w of [...v.windows].sort((a, b) => (a?.startMs ?? 0) - (b?.startMs ?? 0))) {
    if (!record(w) || (w.side !== "left" && w.side !== "right") || !finite(w.startMs) || !finite(w.endMs) || w.endMs <= w.startMs
      || ![true, false, null].includes(w.contact as boolean | null) || !["verified", "uncertain"].includes(String(w.certainty))
      || ![w.region, w.probe].every(s => s === null || typeof s === "string" && s.length <= 64) || w.startMs < ends[w.side]) throw new Error("Khoảng nhãn sai hoặc chồng lấn trên cùng tay.");
    ends[w.side] = w.endMs;
  }
  return v as unknown as FaceContactAnnotations;
}
export async function createFaceContactAnnotationTemplate(recording: MotionRecordingV1): Promise<FaceContactAnnotations> {
  return { version: 1, kind: "veiltalk-face-contact-labels", recordingSha256: await faceRecordingHash(recording), subjectId: "subject-01", sessionId: "session-01", split: "test",
    windows: ["left", "right"].map(side => ({ side: side as "left" | "right", startMs: recording.frames[0].atMs, endMs: recording.frames.at(-1)!.atMs + 1, contact: null, region: null, probe: null, certainty: "uncertain" })) };
}
export interface ContactPrediction { atMs: number; side: "left" | "right"; contact: boolean | null; region: string | null; probe: string | null }
const active = (d: ContactRuntimeDiagnostic) => ["touch", "hold", "slide"].includes(d.phase);
const ratio = (a: number, b: number) => b ? a / b : null;
export function evaluateFaceContactPredictions(predictions: ContactPrediction[], annotations: FaceContactAnnotations | null) {
  let tp = 0, fp = 0, tn = 0, fn = 0, labelled = 0, abstained = 0, abstainedPositive=0, regionN = 0, regionCorrect = 0, probeN = 0, probeCorrect = 0;
  const regionRows:Array<[string,string|null]>=[],probeRows:Array<[string,string|null]>=[];
  for (const p of predictions) {
    const label = annotations?.windows.find(w => w.side === p.side && w.startMs <= p.atMs && p.atMs < w.endMs && w.certainty === "verified" && w.contact !== null);
    if (!label) continue;
    labelled++;
    if(label.contact&&label.region!==null)regionRows.push([label.region,p.contact===true?p.region:null]);
    if(label.contact&&label.probe!==null)probeRows.push([label.probe,p.contact===true?p.probe:null]);
    if (p.contact === null) { abstained++;if(label.contact)abstainedPositive++; continue; }
    if (label.contact) { if (p.contact) tp++; else fn++; } else { if (p.contact) fp++; else tn++; }
    if (label.contact && p.contact && label.region !== null) { regionN++; if (label.region === p.region) regionCorrect++; }
    if (label.contact && p.contact && label.probe !== null) { probeN++; if (label.probe === p.probe) probeCorrect++; }
  }
  const positiveF1 = ratio(2 * tp, 2 * tp + fp + fn), negativeF1 = ratio(2 * tn, 2 * tn + fp + fn);
  // Events are evaluated inside explicitly verified windows; unknown/unlabelled time cannot become a negative.
  const truth = (annotations?.windows ?? []).filter(w => w.certainty === "verified" && w.contact === true);
  const predicted: Array<{side: string;startMs:number;endMs:number}> = [];
  for (const side of ["left", "right"] as const) {
    let event: typeof predicted[number] | null = null;
    const rows = predictions.filter(p => p.side === side).sort((a,b) => a.atMs-b.atMs);
    rows.forEach((p, i) => {
      const verified = annotations?.windows.some(w => w.side === side && w.certainty === "verified" && w.contact !== null && w.startMs <= p.atMs && p.atMs < w.endMs);
      if (p.contact === true && verified) {
        if (!event || p.atMs-event.endMs > 150) { event = {side,startMs:p.atMs,endMs:p.atMs}; predicted.push(event); }
        event.endMs = Math.min(rows[i+1]?.atMs ?? p.atMs+1,p.atMs+150);
      } else event = null;
    });
  }
  const candidates: Array<{p:number;t:number;iou:number}> = [];
  predicted.forEach((p, i) => truth.forEach((t, j) => { if (p.side !== t.side) return;
    const overlap = Math.max(0, Math.min(p.endMs,t.endMs)-Math.max(p.startMs,t.startMs)), union = Math.max(p.endMs,t.endMs)-Math.min(p.startMs,t.startMs);
    if (overlap/union >= .3) candidates.push({p:i,t:j,iou:overlap/union});
  }));
  const matchedP = new Set<number>(), matchedT = new Set<number>(), onsetErrors: number[] = [];
  candidates.sort((a,b)=>b.iou-a.iou).forEach(c => { if (matchedP.has(c.p)||matchedT.has(c.t)) return; matchedP.add(c.p);matchedT.add(c.t);onsetErrors.push(predicted[c.p].startMs-truth[c.t].startMs); });
  return { labelledFrames: labelled, abstainedFrames: abstained, classifiedCoverage: ratio(labelled-abstained,labelled), confusion: {tp,fp,tn,fn},
    selectivePrecision:ratio(tp,tp+fp), selectiveRecall:ratio(tp,tp+fn), recallIncludingAbstentions:ratio(tp,tp+fn+abstainedPositive),positiveF1, macroF1:positiveF1===null||negativeF1===null?null:(positiveF1+negativeF1)/2,
    regionClassification:multiclassMetrics(regionRows),probeClassification:multiclassMetrics(probeRows),
    regionAccuracy:ratio(regionCorrect,regionN), regionDenominator:regionN, probeAccuracy:ratio(probeCorrect,probeN), probeDenominator:probeN,
    events:{temporalIouThreshold:.3,trueEvents:truth.length,predictedEvents:predicted.length,tp:matchedT.size,fp:predicted.length-matchedP.size,fn:truth.length-matchedT.size,onsetErrorsMs:onsetErrors,onsetWithin150Ms:ratio(onsetErrors.filter(n=>Math.abs(n)<=150).length,onsetErrors.length)},
    definitions:"Selective frame scores exclude abstentions and report coverage; recallIncludingAbstentions includes missed uncertain positives. Classification macro-F1 includes missed contacts. Accuracy is conditional on true-positive frames. Unlabelled/uncertain truth excluded. Merge windows for one continuous contact before event scoring." };
}
function multiclassMetrics(rows:Array<[string,string|null]>){
  const classes=[...new Set(rows.map(r=>r[0]))],confusion:Record<string,Record<string,number>>={};
  for(const[t,p]of rows){const row=confusion[t]??={};row[p??"unknown-or-missed"]=(row[p??"unknown-or-missed"]??0)+1;}
  const perClass=classes.map(c=>{const tp=rows.filter(([t,p])=>t===c&&p===c).length,fn=rows.filter(([t,p])=>t===c&&p!==c).length,fp=rows.filter(([t,p])=>t!==c&&p===c).length;return{class:c,tp,fp,fn,f1:ratio(2*tp,2*tp+fp+fn)};});
  return{denominator:rows.length,confusion,perClass,macroF1:perClass.length?perClass.reduce((sum,c)=>sum+(c.f1??0),0)/perClass.length:null};
}
const p95 = (xs:number[]) => xs.length?[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*.95)-1]:null;
export async function compareFaceContactRecording(recording: MotionRecordingV1, annotations: FaceContactAnnotations | null) {
  const hash = await faceRecordingHash(recording);
  if (annotations && annotations.recordingSha256 !== hash) throw new Error("Nhãn thuộc replay khác (SHA-256 không khớp).");
  const rig = recording.metadata.rigProfile as NormalizedAvatarRigProfile | null;
  if (!rig) throw new Error("Replay thiếu rig của avatar.");
  if (annotations?.windows.some(w=>w.startMs<recording.frames[0].atMs||w.endMs>recording.frames.at(-1)!.atMs+151)) throw new Error("Khoảng nhãn vượt thời gian replay.");
  const results = [];
  for (const variant of FACE_CONTACT_ABLATIONS) {
    let clock = recording.frames[0].atMs;
    const processor = new AvatarMotionProcessor({now:()=>clock,filtered:recording.metadata.filtered!==false,constraints:recording.metadata.constraints!==false,continuousFingerEnabled:true,handTwistEnabled:true});
    const predictions:ContactPrediction[]=[], times:number[]=[], contactTimes:number[]=[];
    let corrections=0, nonFinite=0;
    try {
      processor.setRigProfile(rig);processor.setUpperBodyRigProfile(recording.metadata.upperBodyRigProfile as UpperBodyRigProfileV1|null??null);processor.setFingerRig(recording.metadata.fingerRig as FingerRigProfile|null??null);
      processor.setContactShadowEnabled(true);processor.setContactCorrectionEnabled(true);processor.setFaceContactResearchOptions(variant.options);
      for (const entry of recording.frames) {
        clock=entry.atMs;const before=performance.now(),packet=processor.process(entry.raw);times.push(performance.now()-before);
        for (const q of Object.values(packet.jointRotations)) if(q && ![q.x,q.y,q.z,q.w].every(Number.isFinite))nonFinite++;
        const diagnostic=processor.getContactDiagnostics();
        for(const side of ["left","right"] as const){const d=diagnostic[side]; if(!d)continue;
          predictions.push({atMs:entry.atMs,side,contact:active(d)?true:d.depthRelation==="unknown"?null:false,region:d.anatomicalLabel??d.region,probe:d.probe});
          if(d.correctionApplied)corrections++;if(d.research)contactTimes.push(d.research.processorMs);
        }
      }
    } finally {processor.dispose();}
    results.push({name:variant.name,options:variant.options,frames:recording.frames.length,processorP95Ms:p95(times),contactSideP95Ms:p95(contactTimes),correctionFrames:corrections,nonFiniteRotations:nonFinite,metrics:evaluateFaceContactPredictions(predictions,annotations)});
    // Let browser paint between variants; each processor has independent temporal/calibration state.
    await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  return {version:1,experimentVersion:FACE_CONTACT_EXPERIMENT_VERSION,recordingSha256:hash,subjectId:annotations?.subjectId??null,sessionId:annotations?.sessionId??null,split:annotations?.split??null,results,
    capturedRenderer:measureCapturedFaceSkin(recording), limitations:["Processor ablations do not measure renderer refinement; A5 can only be assessed with rendered replays.","Scores are heuristic; no learned calibration or webcam accuracy is claimed.","No confidence interval without independent subjects. Repeat on held-out people, sessions and avatars."]};
}
/** A recorder may capture the preceding rendered packet: align by sequence, never array position. */
export function measureCapturedFaceSkin(recording:MotionRecordingV1){
  const sequences = new Map(recording.frames.filter(f=>f.packet).map(f=>[f.packet!.sequence,f.packet!.sourceFrameTimestampMs])), seen=new Set<number>();
  const gaps:number[]=[],normal:number[]=[],penetration:number[]=[];let unmatched=0;
  for(const frame of recording.frames){const final=frame.finalPose;if(!record(final)||!record(final.contacts)||!record(final.contacts.faceSkin))continue;
    const skin=final.contacts.faceSkin,sequence=skin.sequence;if(!finite(sequence)||!sequences.has(sequence)||(finite(skin.sourceFrameTimestampMs)&&finite(sequences.get(sequence))&&skin.sourceFrameTimestampMs!==sequences.get(sequence))){unmatched++;continue;}if(seen.has(sequence))continue;seen.add(sequence);
    if(!record(skin.contacts))continue;for(const c of Object.values(skin.contacts)){if(!record(c))continue;if(finite(c.gapFaceHeights))gaps.push(c.gapFaceHeights);if(finite(c.normalDegrees))normal.push(c.normalDegrees);if(finite(c.localPenetration))penetration.push(c.localPenetration);}
  }
  return{matchedSequences:seen.size,unmatchedSequences:unmatched,samples:gaps.length,gapFaceHeightP95:p95(gaps),normalDegreesP95:p95(normal),localPenetrationP95:p95(penetration),options:recording.metadata.faceContactResearch as FaceContactResearchOptions|undefined??null,scope:"Captured renderer configuration only. Local signed plane penetration is not a full-mesh penetration measure."};
}
