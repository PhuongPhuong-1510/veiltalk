import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { retargetArmEndpoint } from "./rigAwareArmEndpoint";

describe("rig-aware reach objective", () => {
  it("preserves normalized endpoint across different avatar proportions", () => {
    const result = retargetArmEndpoint({shoulder:{x:0,y:0,z:0},elbow:{x:.3,y:.2,z:0},wrist:{x:.6,y:0,z:0},avatarUpperLength:.4,avatarLowerLength:.2})!;
    expect(result).not.toBeNull();
    const endpoint = new Vector3(result.upperDirection.x,result.upperDirection.y,result.upperDirection.z).multiplyScalar(.4)
      .add(new Vector3(result.lowerDirection.x,result.lowerDirection.y,result.lowerDirection.z).multiplyScalar(.2));
    expect(endpoint.x/.6).toBeCloseTo(.6/(2*Math.hypot(.3,.2)),6);
    expect(endpoint.y).toBeCloseTo(0,6); expect(endpoint.z).toBeCloseTo(0,6);
    expect(result.upperDirection.y).toBeGreaterThan(0);
  });
  it("keeps baseline at a singular bend plane and rejects invalid lengths", () => {
    const pose={shoulder:{x:0,y:0,z:0},elbow:{x:.3,y:0,z:0},wrist:{x:.6,y:0,z:0}};
    expect(retargetArmEndpoint({...pose,avatarUpperLength:.3,avatarLowerLength:.3})).toBeNull();
    expect(retargetArmEndpoint({...pose,avatarUpperLength:-1,avatarLowerLength:.3})).toBeNull();
  });
});
