import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";
import type { BodyContactRegion, ContactPoint2 } from "./bodyContactTypes";
import type { AvatarContactLocalAnchor } from "./contactAnchorMapping";

export interface AvatarSkinBinding { meshKey: string; indices: readonly [number, number, number]; weights: readonly [number, number, number] }
export interface AvatarFaceSurfaceProfile {
  version: 1;
  modelFingerprint: string;
  source: "skin-weight-material-geometry" | "manual-approved";
  faceHeight: number;
  quality: number;
  vertices: Array<{ pointLocal: Vector3Data; uv: ContactPoint2; meshKey: string; vertex: number; frontDistance?:number }>;
  triangles: Array<readonly [number, number, number]>;
  materials: string[];
  rejected: string[];
}
export function validateAvatarFaceSurface(p: AvatarFaceSurfaceProfile): boolean {
  return p.version === 1 && !!p.modelFingerprint && Number.isFinite(p.faceHeight) && p.faceHeight > 1e-5 && Number.isFinite(p.quality) && p.quality >= 0 && p.quality <= 1
    && p.vertices.length <= 16000 && p.triangles.length >= 12 && p.triangles.length <= 12000
    && ["skin-weight-material-geometry","manual-approved"].includes(p.source)
    && p.vertices.every(v => !!v.meshKey && Number.isInteger(v.vertex) && v.vertex >= 0 && [v.pointLocal.x, v.pointLocal.y, v.pointLocal.z, v.uv.x, v.uv.y].every(Number.isFinite)&&(v.frontDistance===undefined||Number.isFinite(v.frontDistance)))
    && p.triangles.every(t => t.length === 3 && t.every(i => Number.isInteger(i) && i >= 0 && i < p.vertices.length));
}
const vec = (v: Vector3Data) => new Vector3(v.x, v.y, v.z);
const data = (v: Vector3): Vector3Data => ({ x: v.x, y: v.y, z: v.z });

/** Mesh UV atlas is semantic head geometry, never VRM texture UV or MediaPipe vertex IDs. */
export function mapAvatarFaceSurface(profile: AvatarFaceSurfaceProfile, uv: ContactPoint2, region: BodyContactRegion, tangentAngleRadians = 0): AvatarContactLocalAnchor | null {
  if(![uv.x,uv.y,tangentAngleRadians].every(Number.isFinite))return null;
  let best: { triangle: readonly [number, number, number]; weights: [number, number, number]; point: Vector3; normal: Vector3; cost: number } | null = null;
  for (const triangle of profile.triangles) {
    const [a, b, c] = triangle.map(i => profile.vertices[i]);
    const den = (b.uv.y - c.uv.y) * (a.uv.x - c.uv.x) + (c.uv.x - b.uv.x) * (a.uv.y - c.uv.y);
    if (Math.abs(den) < 1e-9) continue;
    let x = ((b.uv.y - c.uv.y) * (uv.x - c.uv.x) + (c.uv.x - b.uv.x) * (uv.y - c.uv.y)) / den;
    let y = ((c.uv.y - a.uv.y) * (uv.x - c.uv.x) + (a.uv.x - c.uv.x) * (uv.y - c.uv.y)) / den;
    let z = 1 - x - y;
    // Bounded nearest-triangle fallback across tiny atlas holes. Never jump to another mesh.
    x = Math.max(0, x); y = Math.max(0, y); z = Math.max(0, z); const total = x + y + z; x /= total; y /= total; z /= total;
    const distance = Math.hypot(x * a.uv.x + y * b.uv.x + z * c.uv.x - uv.x, x * a.uv.y + y * b.uv.y + z * c.uv.y - uv.y);
    if (distance > .18 || a.meshKey !== b.meshKey || a.meshKey !== c.meshKey) continue;
    const pa = vec(a.pointLocal), pb = vec(b.pointLocal), pc = vec(c.pointLocal);
    const normal = pb.clone().sub(pa).cross(pc.clone().sub(pa)); if (normal.lengthSq() < 1e-16) continue; normal.normalize();
    const point = pa.multiplyScalar(x).addScaledVector(pb, y).addScaledVector(pc, z);
    const front=x*(a.frontDistance??0)+y*(b.frontDistance??0)+z*(c.frontDistance??0);
    const cost = distance-front/profile.faceHeight*1e-7;
    if (!best || cost < best.cost) best = { triangle, weights: [x, y, z], point, normal, cost };
  }
  if (!best) return null;
  const vertices = best.triangle.map(i => profile.vertices[i]);
  const [a,b,c]=vertices,e1=vec(b.pointLocal).sub(vec(a.pointLocal)),e2=vec(c.pointLocal).sub(vec(a.pointLocal));
  const du1=b.uv.x-a.uv.x,du2=c.uv.x-a.uv.x,dv1=b.uv.y-a.uv.y,dv2=c.uv.y-a.uv.y,det=du1*dv2-du2*dv1;
  const tangent=e1.clone().multiplyScalar(dv2/det).addScaledVector(e2,-dv1/det).multiplyScalar(Math.sin(tangentAngleRadians))
    .add(e2.clone().multiplyScalar(du1/det).addScaledVector(e1,-du2/det).multiplyScalar(Math.cos(tangentAngleRadians)));
  tangent.addScaledVector(best.normal, -tangent.dot(best.normal));
  if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0).addScaledVector(best.normal, -best.normal.x);
  return { region, parentJoint: "head", surfaceFamily: "head", pointLocal: data(best.point), normalLocal: data(best.normal), tangentLocal: data(tangent.normalize()),
    skinBinding: { meshKey: vertices[0].meshKey, indices: vertices.map(v => v.vertex) as [number, number, number], weights: best.weights },
    surfaceSource: profile.source, faceHeight: profile.faceHeight,
  };
}
