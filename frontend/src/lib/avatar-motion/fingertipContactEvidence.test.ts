import {describe,expect,it} from "vitest";
import {FingertipContactEvidence} from "./fingertipContactEvidence";
const hand=(right=false)=>{const h=Array.from({length:21},()=>({x:right?.8:.1,y:.4,z:0,visibility:1}));h[5].x=.25;h[17].x=.35;h[8].x=right?.409:.4;return h;};
describe("observed fingertip pair proposals",()=>{
  it("requires three distinct samples and sustained proximity; duplicates cannot acquire or renew",()=>{
    const e=new FingertipContactEvidence();expect(e.update(hand(),hand(true),100,100,1000,1000)).toBeUndefined();
    for(let n=0;n<8;n++)expect(e.update(hand(),hand(true),100,120,1000,1000)).toBeUndefined();
    expect(e.update(hand(),hand(true),140,140,1000,1000)).toBeUndefined();
    expect(e.update(hand(),hand(true),180,180,1000,1000)?.pairs).toEqual([{left:"index",right:"index",influence:.35}]);
    expect(e.update(hand(),hand(true),180,900,1000,1000)).toBeUndefined();
  });
  it("clears on identity changes, loss, clock restart, separation and long detector gaps",()=>{
    for(const mode of ["identity","loss","clock","gap","separation"]){
      const e=new FingertipContactEvidence();for(const at of [100,140,180])e.update(hand(),hand(true),at,at,1000,1000);
      const far=hand(true);far[8].x=.7;
      expect(e.update(mode==="loss"?null:hand(),mode==="separation"?far:hand(true),mode==="clock"?10:mode==="gap"?500:220,mode==="clock"?10:mode==="gap"?500:220,1000,1000,mode==="identity")).toBeUndefined();
    }
  });
  it("is invariant to uniform image scale and rejects invalid landmarks",()=>{
    const e=new FingertipContactEvidence(),scale=(h:ReturnType<typeof hand>)=>h.map(p=>({...p,x:p.x*.5,y:p.y*.5}));
    let intent;for(const at of [100,140,180])intent=e.update(scale(hand()),scale(hand(true)),at,at,1000,1000);
    expect(intent?.pairs[0].left).toBe("index");
    const bad=hand();bad[5].x=NaN;expect(e.update(bad,hand(true),220,220,1000,1000)).toBeUndefined();
  });
});
