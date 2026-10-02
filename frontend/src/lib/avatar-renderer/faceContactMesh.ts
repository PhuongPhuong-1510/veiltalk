import { Material, SkinnedMesh, Vector3, type Object3D } from "three";
import type { NormalizedAvatarRigProfile, RigContactProbeReference } from "../avatar-motion/normalizedRigProfile";
import { mapAvatarFaceSurface, validateAvatarFaceSurface, type AvatarFaceSurfaceProfile, type AvatarSkinBinding } from "../avatar-motion/avatarFaceSurface";
import type { SemanticBoneFrame } from "./renderedContactGeometry";
import { semanticRenderedRotation } from "./renderedContactGeometry";

export interface FaceMeshContactCapability { status: "mesh-candidate" | "manual-approved" | "proxy-fallback"; materials: string[]; triangles: number; quality: number; reasons: string[]; regionCoverage?:Record<string,boolean> }
const data = (v: Vector3) => ({ x: v.x, y: v.y, z: v.z });
const vec = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);
const finite = (v: Vector3) => v.toArray().every(Number.isFinite);
const quantile = (v: number[], t: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * t)];
function meshKey(mesh: SkinnedMesh): string { const path: string[] = []; let node: Object3D | null = mesh; while (node) { path.unshift(`${node.name || node.type}:${node.parent?.children.indexOf(node) ?? 0}`); node = node.parent; } return path.join("/"); }
function skinWeight(mesh: SkinnedMesh, vertex: number, bones: ReadonlySet<Object3D>): number {
  const ids = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight"); if (!ids || !weights) return 0;
  let sum = 0; for (let j = 0; j < 4; j++) if (bones.has(mesh.skeleton.bones[ids.getComponent(vertex, j)])) sum += weights.getComponent(vertex, j); return sum;
}
function eligibleMaterial(material: Material | undefined, approved: readonly string[] | undefined): boolean {
  if(!material)return false;
  if (approved) return approved.includes(material.name);
  // Name is only one cue: fitting also requires head skinning, actual face-zone geometry,
  // outward normals and sufficient continuous triangles. Unknown/cutout accessories fail closed.
  return /skin/i.test(material.name) && !/hair|eye|brow|lash|glass|cloth|mouth|teeth|tongue/i.test(material.name) && material.opacity >= .95;
}

/** Bounded semantic atlas from eligible actual skinned triangles. No texture-UV/topology assumptions. */
export class FaceContactMesh {
  readonly meshes = new Map<string, SkinnedMesh>();
  profile: AvatarFaceSurfaceProfile | null = null;
  capability: FaceMeshContactCapability = { status: "proxy-fallback", materials: [], triangles: 0, quality: 0, reasons: [] };
  constructor(root: Object3D, rig: NormalizedAvatarRigProfile, frames: Map<string, SemanticBoneFrame>, approvedMaterials?: readonly string[]) {
    const head = frames.get("head"), collision = rig.collisionReference;
    if (!head || !collision) { this.capability.reasons.push("missing-head-reference"); return; }
    root.updateMatrixWorld(true);
    const origin = head.bone.getWorldPosition(new Vector3()), inverse = semanticRenderedRotation(head).invert(),headBones=new Set([head.bone]);
    const up = vec(rig.torsoReference.upWorld), right = vec(rig.torsoReference.rightWorld), forward = vec(rig.torsoReference.forwardWorld);
    // Bone-derived collision spheres can be far smaller than stylized faces. Fit the skin
    // extent independently; the collision proxy remains unchanged for the baseline solver.
    const skinPoints:Vector3[]=[],positionCache=new Map<SkinnedMesh,Map<number,Vector3>>();
    root.traverse(node=>{
      if(!(node instanceof SkinnedMesh))return;const materials=Array.isArray(node.material)?node.material:[node.material],position=node.geometry.getAttribute("position"),index=node.geometry.index;
      if(!position||!materials.some(m=>eligibleMaterial(m,approvedMaterials)))return;node.skeleton.update();const cache=new Map<number,Vector3>();positionCache.set(node,cache);
      const groups=node.geometry.groups.length?node.geometry.groups:[{start:0,count:index?.count??position.count,materialIndex:0}];
      for(const g of groups){if(!eligibleMaterial(materials[g.materialIndex??0],approvedMaterials))continue;for(let o=g.start;o<Math.min(g.start+g.count,index?.count??position.count);o++){
        const i=index?index.getX(o):o;if(cache.has(i)||skinWeight(node,i,headBones)<.55)continue;const p=node.localToWorld(node.getVertexPosition(i,new Vector3()));if(!finite(p))continue;cache.set(i,p);skinPoints.push(p.clone().sub(origin));
      }}
    });
    if(skinPoints.length<12){this.capability.reasons.push("insufficient-head-skinned-vertices");return;}
    const skinY=skinPoints.map(p=>p.dot(up)),skinX=skinPoints.map(p=>p.dot(right)),skinLow=quantile(skinY,.01),skinHigh=quantile(skinY,.99);
    const center=origin.clone().addScaledVector(up,(skinLow+skinHigh)*.5),radius=Math.max(collision.head.radius,(skinHigh-skinLow)*.6,Math.abs(quantile(skinX,.01)),Math.abs(quantile(skinX,.99)));
    const vertices: AvatarFaceSurfaceProfile["vertices"] = [], triangles: AvatarFaceSurfaceProfile["triangles"] = [], usedMaterials = new Set<string>();
    const atlasPoints: Vector3[] = [];
    root.traverse(node => {
      if (!(node instanceof SkinnedMesh)) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (!materials.some(m => eligibleMaterial(m, approvedMaterials))) return;
      node.skeleton.update(); const key = meshKey(node); this.meshes.set(key, node);
      const index = node.geometry.index, position = node.geometry.getAttribute("position"); if (!position) return;
      const groups = node.geometry.groups.length ? node.geometry.groups : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
      const vertexMap = new Map<number, number>();
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0]; if (!material || !eligibleMaterial(material, approvedMaterials)) continue;
        const end = Math.min(group.start + group.count, index?.count ?? position.count);
        for (let offset = group.start; offset + 2 < end && triangles.length < 12000; offset += 3) {
          const ids = [0, 1, 2].map(i => index ? index.getX(offset + i) : offset + i);
          const cache=positionCache.get(node);if(!cache||!ids.every(i=>cache.has(i)))continue;
          const points = ids.map(i => cache.get(i)!);
          if (!points.every(finite)) continue;
          const centroid = points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3), relative = centroid.clone().sub(center);
          const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
          // Some double-sided assets wind skin inward. Store a consistently outward binding
          // using the fitted head center, so mapping and later sampling share the same normal.
          const reverse=normal.dot(relative)<0;if(reverse)normal.negate();
          if (relative.dot(forward) < radius * .05 || Math.abs(relative.dot(right)) > radius * 1.25 || relative.dot(up) < -radius * .95 || relative.dot(up) > radius * .75 || normal.dot(forward) < .08) continue;
          const triangle = ids.map((i, j) => {
            let id = vertexMap.get(i); if (id !== undefined) return id;
            id = vertices.length; vertexMap.set(i, id);
            const p = points[j].clone().sub(origin).applyQuaternion(inverse);
            vertices.push({ pointLocal: data(p), uv: { x: 0, y: 0 }, meshKey: key, vertex: i });
            const delta = points[j].clone().sub(center); atlasPoints.push(new Vector3(delta.dot(right), delta.dot(up), delta.dot(forward))); return id;
          }) as [number, number, number];
          if(reverse)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
          triangles.push(triangle); usedMaterials.add(material.name);
        }
      }
    });
    if (triangles.length < 12 || vertices.length > 16000) { this.capability.reasons.push("insufficient-eligible-face-triangles"); return; }
    const ys = atlasPoints.map(v => v.y), xs = atlasPoints.map(v => v.x), low = quantile(ys, .01), high = quantile(ys, .99);
    const halfWidth = Math.max(Math.abs(quantile(xs, .01)), Math.abs(quantile(xs, .99))), faceHeight = high - low;
    if (!(faceHeight > radius * .4 && halfWidth > radius * .2)) { this.capability.reasons.push("implausible-face-extent"); return; }
    vertices.forEach((v, i) => { v.uv = { x: atlasPoints[i].x / halfWidth, y: -(atlasPoints[i].y - (high + low) * .5) / (faceHeight * .5) };v.frontDistance=atlasPoints[i].z; });
    const profile: AvatarFaceSurfaceProfile = { version: 1, modelFingerprint: rig.modelFingerprint, source: approvedMaterials ? "manual-approved" : "skin-weight-material-geometry", faceHeight, quality: approvedMaterials ? .9 : .7, vertices, triangles, materials: [...usedMaterials], rejected: [] };
    if (!validateAvatarFaceSurface(profile)) { this.capability.reasons.push("invalid-atlas"); return; }
    this.profile = profile; this.capability = { status: approvedMaterials ? "manual-approved" : "mesh-candidate", materials: profile.materials, triangles: triangles.length, quality: profile.quality, reasons: [] };
    this.capability.regionCoverage={leftCheek:!!mapAvatarFaceSurface(profile,{x:.45,y:.2},"leftCheek"),rightCheek:!!mapAvatarFaceSurface(profile,{x:-.45,y:.2},"rightCheek"),forehead:!!mapAvatarFaceSurface(profile,{x:0,y:-.7},"forehead"),leftTemple:!!mapAvatarFaceSurface(profile,{x:.8,y:-.1},"leftCheek"),rightTemple:!!mapAvatarFaceSurface(profile,{x:-.8,y:-.1},"rightCheek")};
    for(const [region,mapped]of Object.entries(this.capability.regionCoverage))if(!mapped)this.capability.reasons.push(`${region}:atlas-hole-proxy-fallback`);
  }
  sample(binding: AvatarSkinBinding): { point: Vector3; normal: Vector3 } | null {
    const mesh = this.meshes.get(binding.meshKey); if (!mesh || binding.indices.length!==3||binding.weights.length!==3||!binding.indices.every(i => Number.isInteger(i) && i >= 0 && i < mesh.geometry.getAttribute("position").count) || !binding.weights.every(n=>Number.isFinite(n)&&n>=0&&n<=1) || Math.abs(binding.weights.reduce((s, n) => s + n, 0) - 1) > .001) return null;
    mesh.skeleton.update();
    const points = binding.indices.map(i => mesh.localToWorld(mesh.getVertexPosition(i, new Vector3())));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
    const point = points[0].clone().multiplyScalar(binding.weights[0]).addScaledVector(points[1], binding.weights[1]).addScaledVector(points[2], binding.weights[2]);
    return finite(point) && finite(normal) && normal.lengthSq() > .99 ? { point, normal } : null;
  }
}

/** Project a rigid hand probe onto eligible skin geometry near its own palm/edge zone. */
export function fitHandSkinProbe(root: Object3D, frame: SemanticBoneFrame, probe: RigContactProbeReference, palmWidth: number): RigContactProbeReference | null {
  const wrist = frame.bone.getWorldPosition(new Vector3()), rotation = semanticRenderedRotation(frame), inverse = rotation.clone().invert();
  const target = vec(probe.offsetLocal), direction = vec(probe.normalLocal),handBones=new Set([frame.bone]); let best: Vector3 | null = null, bestError = Infinity;
  root.traverse(node => {
    if (!(node instanceof SkinnedMesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material], position = node.geometry.getAttribute("position"), index = node.geometry.index;
    if (!position) return; node.skeleton.update();
    const groups = node.geometry.groups.length ? node.geometry.groups : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
    const visited = new Set<number>();
    for (const group of groups) {
      if (!eligibleMaterial(materials[group.materialIndex ?? 0], undefined)) continue;
      const end = Math.min(group.start + group.count, index?.count ?? position.count);
      for (let offset = group.start; offset < end; offset++) {
        const i = index ? index.getX(offset) : offset; if (visited.has(i)) continue; visited.add(i);
        if (skinWeight(node, i, handBones) < .5) continue;
        const p = node.localToWorld(node.getVertexPosition(i, new Vector3())).sub(wrist).applyQuaternion(inverse), delta = p.clone().sub(target);
        const along = delta.dot(direction), tangent = delta.clone().addScaledVector(direction, -along).length();
        if (along < 0 || along > palmWidth * .35 || tangent > palmWidth * .16) continue;
        const error = tangent * 3 + Math.abs(along); if (error < bestError) { best = p; bestError = error; }
      }
    }
  });
  return best ? { ...probe, offsetLocal: data(best) } : null;
}
