import { Euler, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { clampQuaternionEllipsoid, quaternionExp, quaternionLog } from "./quaternionDistribution";

const data=(q:Quaternion)=>({x:q.x,y:q.y,z:q.z,w:q.w});
describe("AR4 quaternion distribution math",()=>{
  it("round-trips log/exp at zero, combined rotation and near pi",()=>{
    for(const q of [new Quaternion(),new Quaternion().setFromEuler(new Euler(.3,-.4,.2,"XYZ")),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI-1e-6)]){
      const log=quaternionLog(data(q))!;const rebuilt=quaternionExp(log)!;
      expect(new Quaternion(rebuilt.x,rebuilt.y,rebuilt.z,rebuilt.w).angleTo(q)).toBeLessThan(1e-5);
    }
  });
  it("uses the asymmetric ellipsoid for the final aggregate cap",()=>{
    const input=quaternionExp({x:.5,y:.5,z:0})!;
    const safe=clampQuaternionEllipsoid(input,{pitchUp:.4,pitchDown:.3,yawLeft:.4,yawRight:.4,rollLeft:.2,rollRight:.2})!;
    const r=quaternionLog(safe)!;
    expect((r.x/.4)**2+(r.y/.4)**2).toBeCloseTo(1,5);
  });
});
