export type InterArmDepthOrdering = "left-front" | "right-front" | null;

export interface InterArmDepthOrderingSnapshot {
  ordering: InterArmDepthOrdering;
  pending: InterArmDepthOrdering;
  pendingSamples: number;
  normalizedDepthDelta: number;
  confidence: number;
  lastSampledAtMs: number | null;
}

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));

/** Detector-sample-driven topology tracker. Duplicate render frames never confirm an ordering. */
export class InterArmDepthOrderingTracker {
  private state:InterArmDepthOrderingSnapshot={ordering:null,pending:null,pendingSamples:0,normalizedDepthDelta:0,confidence:0,lastSampledAtMs:null};
  reset():void{this.state={ordering:null,pending:null,pendingSamples:0,normalizedDepthDelta:0,confidence:0,lastSampledAtMs:null};}
  snapshot():InterArmDepthOrderingSnapshot{return{...this.state};}
  update(input:{leftWristZ:number;rightWristZ:number;depthThreshold:number;leftTrust:number;rightTrust:number;sampledAtMs:number}):InterArmDepthOrderingSnapshot{
    if(![input.leftWristZ,input.rightWristZ,input.sampledAtMs].every(Number.isFinite))return this.snapshot();
    if(this.state.lastSampledAtMs===input.sampledAtMs)return this.snapshot();
    if(this.state.lastSampledAtMs!==null&&input.sampledAtMs<this.state.lastSampledAtMs){this.reset();}
    this.state.lastSampledAtMs=input.sampledAtMs;
    const threshold=Number.isFinite(input.depthThreshold)&&input.depthThreshold>1e-8?input.depthThreshold:1e-3;
    const delta=input.leftWristZ-input.rightWristZ;
    const normalized=delta/threshold;
    const trust=clamp01(Math.min(input.leftTrust,input.rightTrust));
    const enter=1+(1-trust)*.9;
    const proposed:InterArmDepthOrdering=delta>=0?"left-front":"right-front";
    this.state.normalizedDepthDelta=normalized;
    this.state.confidence=clamp01((Math.abs(normalized)-.5)/Math.max(.5,enter))*trust;
    if(Math.abs(normalized)<enter||proposed===this.state.ordering){this.state.pending=null;this.state.pendingSamples=0;return this.snapshot();}
    if(this.state.pending===proposed)this.state.pendingSamples+=1;else{this.state.pending=proposed;this.state.pendingSamples=1;}
    const required=trust>=.8?2:3;
    if(this.state.pendingSamples>=required){this.state.ordering=proposed;this.state.pending=null;this.state.pendingSamples=0;}
    return this.snapshot();
  }
}
