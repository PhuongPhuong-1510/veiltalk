import type { RawHandCandidateV1, RawNormalizedLandmarkV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { MotionRecordingV1, MotionScene } from "./motionReplay";
import { CANONICAL_FACE_VERTICES } from "./faceContactTopology";

const point = (x: number,y: number,z=0,visibility=1): RawNormalizedLandmarkV1 => ({x,y,z,visibility});
const project = (p: RawNormalizedLandmarkV1): RawNormalizedLandmarkV1 => ({...p,x:.5+p.x*.5,y:.4+p.y*.5*1280/720});
function hand(side: "left"|"right", wrist: RawNormalizedLandmarkV1, at: number): RawHandCandidateV1 {
  const sign=side==="left"?1:-1;
  const world=Array.from({length:21},()=>point(0,0));
  world[1]=point(sign*.02,-.005);world[2]=point(sign*.035,-.015);world[3]=point(sign*.05,-.023);world[4]=point(sign*.067,-.026);
  for(const [root,x,length] of [[5,.022,.07],[9,0,.085],[13,-.018,.075],[17,-.033,.055]]) {
    for(let segment=0;segment<4;segment++)world[root+segment]=point(sign*x,-.05-length*segment/3,.003*segment);
  }
  const projectedWrist=project(wrist);
  const image=world.map(p=>point(projectedWrist.x+p.x*.5,projectedWrist.y+p.y*.5*1280/720,p.z*.5));
  return {sourceIndex:side==="left"?0:1,sampledAtMs:at,handedness:side,handednessScore:.95,landmarks:image,worldLandmarks:world};
}

/** Deterministic geometry/stale-data fixtures; never presented as webcam/XR quality evidence. */
export function createSyntheticMotionRecording(scene: MotionScene, metadata: Record<string, unknown>, count=180): MotionRecordingV1 {
  const frames: MotionRecordingV1["frames"]=[];
  for(let index=0;index<count;index++) {
    const at=1000+index*1000/30, phase=index/count*Math.PI*2;
    const faceWorld=scene.startsWith("face-")?CANONICAL_FACE_VERTICES.map(p=>point(p[0]*.009,-.35-p[1]*.009,-p[2]*.009)):null;
    const pose=Array.from({length:33},()=>point(0,-.35));
    pose[7]=point(.08,-.35);pose[8]=point(-.08,-.35);pose[11]=point(.18,-.15);pose[12]=point(-.18,-.15);
    pose[23]=point(.13,.42);pose[24]=point(-.13,.42);
    for(const side of ["left","right"] as const){
      const sign=side==="left"?1:-1,e=side==="left"?13:14,w=side==="left"?15:16;
      pose[e]=point(sign*.34,.08,0);pose[w]=point(sign*.38,.32,-.03);
      if(scene==="static"){const noise=Math.sin(index*2.3)*.002;pose[e].z+=noise;pose[w].x+=noise;}
      if(scene==="overhead"||scene==="behind-head"){const height=(1-Math.cos(phase))*.5;pose[e]=point(sign*.34,.08-height*.55,-.02);pose[w]=point(sign*.15,.32-height*.9,scene==="behind-head"?.12*height:-.05);}
      if(scene==="crossing"||scene==="palms-together"){const cross=(1-Math.cos(phase))*.5;pose[e].x=sign*(.34-cross*.1);pose[w].x=sign*(.38-cross*(scene==="crossing"?.6:.36));pose[w].z=sign*.06;}
      if(scene==="depth"){pose[w].z=-.03-.18*(1-Math.cos(phase));pose[w].x=sign*(.38-.16*(1-Math.cos(phase))*.5);}
      if(scene==="near-face-no-contact"){pose[e]=point(sign*.28,-.12,-.1);pose[w]=point(sign*.08,-.32,-.22);}
      if(faceWorld){
        const target=faceWorld[scene==="face-forehead"?10:scene==="face-temple-edge"?(side==="left"?454:234):side==="left"?425:205];
        pose[0]={...faceWorld[1]};pose[2]={...faceWorld[33]};pose[5]={...faceWorld[263]};
        const slide=scene==="face-slide"?.018*Math.sin(phase):0,localY=scene==="face-index-tip"?-.12:-.04;
        pose[e]=point(sign*.18,-.18,-.03);pose[w]=point(target.x,target.y-localY+slide,target.z+(scene==="face-near-no-contact"?-.20:0));
      }
    }
    const image=pose.map(project),candidates=[hand("left",pose[15],at),hand("right",pose[16],at)];
    if(scene==="partial-arm"&&index>=60&&index<120)image[13].visibility=0;
    if(scene==="partial-arm"&&index>=120){image[15].visibility=0;candidates.splice(0,1);}
    if(scene==="behind-head"&&index>=60&&index<120){image[13].visibility=0;image[15].visibility=0;candidates.splice(0,1);}
    if(scene==="crossing"&&index%2)candidates.reverse();
    const sideSample=(side:"left"|"right")=>{const candidate=candidates.find(c=>c.handedness===side);return{state:candidate?"tracked" as const:"lost" as const,sampledAtMs:at,handedness:side,handednessScore:candidate?.handednessScore??null,landmarks:candidate?.landmarks??null,worldLandmarks:candidate?.worldLandmarks??null};};
    const raw:RawTrackingFrameV1={version:1,frameTimestampMs:at,overall:"partial",videoWidth:1280,videoHeight:720,
      face:{state:faceWorld?"tracked":"lost",sampledAtMs:at,landmarks:faceWorld?.map(project)??null,blendshapes:null,facialTransform:null},pose:{state:"tracked",sampledAtMs:at,landmarks:image,worldLandmarks:pose},
      leftHand:sideSample("left"),rightHand:sideSample("right"),rawHands:candidates,handSampledThisFrame:true,handSampledAtMs:at};
    frames.push({atMs:at,raw});
  }
  return {version:1,kind:"veiltalk-motion-replay",scene,createdAt:new Date().toISOString(),metadata:{...metadata,inputKind:"synthetic-geometry",groundTruth:"none; not a webcam or XR recording"},frames};
}
