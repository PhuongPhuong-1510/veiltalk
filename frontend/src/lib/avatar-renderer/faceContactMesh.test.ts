import { describe, expect, it } from "vitest";
import { Bone, BufferAttribute, BufferGeometry, Group, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh } from "three";
import { FaceContactMesh } from "./faceContactMesh";
import { captureSemanticBoneFrames } from "./renderedContactGeometry";
import { mapAvatarFaceSurface } from "../avatar-motion/avatarFaceSurface";
import type { NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";

function fixture(materialName = "Face_SKIN", morph = false) {
  const root = new Group(), head = new Bone(); root.add(head);
  const positions: number[] = [], indices: number[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) positions.push(-.20 + x * .10, -.18 + y * .075, .20);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const a = y * 5 + x; indices.push(a, a + 1, a + 5, a + 1, a + 6, a + 5); }
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3)); geometry.setIndex(indices);
  geometry.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(25 * 4), 4));
  geometry.setAttribute("skinWeight", new BufferAttribute(new Float32Array(Array.from({ length: 100 }, (_, i) => i % 4 === 0 ? 1 : 0)), 4));
  if (morph) { geometry.morphTargetsRelative = true; geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(Array.from({ length: 75 }, (_, i) => i % 3 === 2 ? .03 : 0)), 3)]; }
  const material = new MeshBasicMaterial(); material.name = materialName;
  const mesh = new SkinnedMesh(geometry, material); mesh.name = "fixture"; root.add(mesh); root.updateMatrixWorld(true); mesh.bind(new Skeleton([head]));
  const rig = { modelFingerprint: "fixture", torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 } }, collisionReference: { head: { centerWorld: { x: 0, y: 0, z: 0 }, radius: .25 } } } as NormalizedAvatarRigProfile;
  const frames = captureSemanticBoneFrames({ head }, { head });
  return { root, head, mesh, rig, frames };
}
describe("contact skin surface", () => {
  it("maps a semantic anchor to actual eligible triangles and follows skinning/morphs", () => {
    const f = fixture("Face_SKIN", true), contact = new FaceContactMesh(f.root, f.rig, f.frames);
    expect(contact.profile).not.toBeNull();
    const anchor = mapAvatarFaceSurface(contact.profile!, { x: .35, y: .2 }, "leftCheek")!;
    const before = contact.sample(anchor.skinBinding!)!;
    expect(before.point.z).toBeCloseTo(.2, 5);
    f.mesh.morphTargetInfluences![0] = 1; f.head.position.x = .1; f.head.quaternion.copy(new Quaternion()); f.root.updateMatrixWorld(true);
    const after = contact.sample(anchor.skinBinding!)!;
    expect(after.point.z - before.point.z).toBeCloseTo(.03, 5);
    expect(after.point.x - before.point.x).toBeCloseTo(.1, 5);
  });
  it("rejects hair and unknown materials despite the same head skin weights", () => {
    for (const name of ["Hair_SKIN", "Eye_SKIN", "UnknownMaterial"]) { const f = fixture(name); expect(new FaceContactMesh(f.root, f.rig, f.frames).profile).toBeNull(); }
  });
  it("accepts an explicit material allowlist and rejects invalid skin bindings", () => {
    const f = fixture("ArtistFace"), contact = new FaceContactMesh(f.root, f.rig, f.frames, ["ArtistFace"]);
    expect(contact.capability.status).toBe("manual-approved");
    const anchor = mapAvatarFaceSurface(contact.profile!, { x: 0, y: 0 }, "forehead")!;
    expect(contact.sample({ ...anchor.skinBinding!, indices: [10000, 1, 2] })).toBeNull();
    expect(contact.sample({ ...anchor.skinBinding!, weights: [-1,1,1] })).toBeNull();
  });
  it("accepts masked named skin while still excluding accessories, and corrects inward winding",()=>{
    const f=fixture();f.mesh.material.alphaTest=.5;const indices=f.mesh.geometry.index!;for(let i=0;i<indices.count;i+=3){const a=indices.getX(i+1);indices.setX(i+1,indices.getX(i+2));indices.setX(i+2,a);}
    const contact=new FaceContactMesh(f.root,f.rig,f.frames),anchor=mapAvatarFaceSurface(contact.profile!,{x:0,y:0},"forehead")!;
    expect(contact.sample(anchor.skinBinding!)!.normal.z).toBeGreaterThan(.99);expect(anchor.normalLocal.z).toBeGreaterThan(.99);
  });
});
