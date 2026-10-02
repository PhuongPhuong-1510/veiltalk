import type { AvatarFingerName,AvatarFingerJointName } from "./avatarPoseTypes";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

export interface FingertipContactPair {left:AvatarFingerName;right:AvatarFingerName;influence:number}
export interface FingertipContactIntent {version:1;sampledAtMs:number;pairs:FingertipContactPair[];flexionWindows?:Partial<Record<AvatarFingerJointName,{min:number;max:number}>>}
const tips:Record<AvatarFingerName,number>={thumb:4,index:8,middle:12,ring:16,little:20};
const finite=(p:RawNormalizedLandmarkV1|undefined)=>Boolean(p&&[p.x,p.y,p.z].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);

/** Image proximity proposes a pair; final model-space geometry must independently admit it. */
export class FingertipContactEvidence {
  private lastSample:number|null=null;
  private candidates=new Map<string,{count:number;since:number;pair:FingertipContactPair}>();
  reset(){this.lastSample=null;this.candidates.clear();}
  update(left:readonly RawNormalizedLandmarkV1[]|null,right:readonly RawNormalizedLandmarkV1[]|null,at:number|null,now:number,width:number,height:number,identityChanged=false):FingertipContactIntent|undefined{
    if(identityChanged||!Number.isFinite(now)||this.lastSample!==null&&now<this.lastSample)this.reset();
    if(at===null||!Number.isFinite(at)||at>now||now-at>150)return undefined;
    if(this.lastSample!==null&&at<this.lastSample)this.reset();
    if(this.lastSample===at)return this.snapshot(at);
    if(this.lastSample!==null&&at-this.lastSample>200)this.candidates.clear();
    this.lastSample=at;
    if(!left||!right||!(width>0&&height>0)||![left[5],left[17],right[5],right[17]].every(finite)){this.candidates.clear();return undefined;}
    const distance=(a:RawNormalizedLandmarkV1,b:RawNormalizedLandmarkV1)=>Math.hypot(a.x-b.x,(a.y-b.y)*height/width);
    const palm=(distance(left[5],left[17])+distance(right[5],right[17]))/2;
    if(palm<1e-5){this.candidates.clear();return undefined;}
    const available:Array<{key:string;left:AvatarFingerName;right:AvatarFingerName;distance:number}>=[];
    for(const l of Object.keys(tips) as AvatarFingerName[])for(const r of Object.keys(tips) as AvatarFingerName[]){
      const a=left[tips[l]],b=right[tips[r]];if(!finite(a)||!finite(b))continue;
      const d=distance(a,b)/palm;if(d<.22)available.push({key:l+":"+r,left:l,right:r,distance:d});
    }
    // One-to-one assignment prevents a collapsed landmark cluster from pinning all fingers together.
    const usedLeft=new Set<AvatarFingerName>(),usedRight=new Set<AvatarFingerName>(),next=new Map<string,{count:number;since:number;pair:FingertipContactPair}>();
    for(const c of available.sort((a,b)=>a.distance-b.distance)){
      if(usedLeft.has(c.left)||usedRight.has(c.right))continue;
      usedLeft.add(c.left);usedRight.add(c.right);const previous=this.candidates.get(c.key);
      const strength=Math.min(.35,.35*Math.max(0,(.22-c.distance)/.13));
      next.set(c.key,{count:(previous?.count??0)+1,since:previous?.since??at,pair:{left:c.left,right:c.right,influence:strength}});
      if(next.size===2)break;
    }
    this.candidates=next;return this.snapshot(at);
  }
  private snapshot(at:number):FingertipContactIntent|undefined{
    const pairs=[...this.candidates.values()].filter(c=>c.count>=3&&at-c.since>=80).map(c=>c.pair);
    return pairs.length?{version:1,sampledAtMs:at,pairs}:undefined;
  }
}
