import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";
import { inverseQuaternion, multiplyQuaternions } from "./motionMath";
import { clampRotationEllipsoid, quaternionLog } from "./quaternionDistribution";
import { semanticRotationToLocal, type UpperBodyLayer } from "./upperBodyComposer";
import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import type { TorsoBasis } from "./torsoBasis";

const radians = (degrees: number) => degrees * Math.PI / 180;
const LIMITS = { yawLeft:radians(30),yawRight:radians(30),pitchUp:radians(18),pitchDown:radians(25),rollLeft:radians(20),rollRight:radians(20) };
const WEIGHTS = { hips:{x:.08,y:.10,z:.08},spine:{x:.25,y:.22,z:.22},chest:{x:.35,y:.34,z:.35},upperChest:{x:.32,y:.34,z:.35} } as const;

export interface TorsoMotionResult {
  layer: UpperBodyLayer;
  rotation: Vector3Data | null;
  rotationOnlyTorsoOffsetProxy: { lateral: number; depth: number } | null;
  curl: number | null;
}

export function computeRotationOnlyTorsoOffsetProxy(landmarks: RawNormalizedLandmarkV1[] | null, basis: TorsoBasis | null): { lateral: number; depth: number } | null {
  if (!landmarks || !landmarks[11] || !landmarks[12] || !landmarks[23] || !landmarks[24] || !basis) return null;
  const shoulder={x:(landmarks[11].x+landmarks[12].x)/2,y:-(landmarks[11].y+landmarks[12].y)/2,z:-(landmarks[11].z+landmarks[12].z)/2};
  const hip={x:(landmarks[23].x+landmarks[24].x)/2,y:-(landmarks[23].y+landmarks[24].y)/2,z:-(landmarks[23].z+landmarks[24].z)/2};
  const v={x:shoulder.x-hip.x,y:shoulder.y-hip.y,z:shoulder.z-hip.z};
  const dot=(a:Vector3Data,b:Vector3Data)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const height=Math.max(1e-6,Math.abs(dot(v,basis.up)));
  return {lateral:Math.atan2(dot(v,basis.right),height),depth:Math.atan2(dot(v,basis.forward),height)};
}

export function solveTorsoMotion(
  basis: TorsoBasis | null,
  neutralRotation: QuaternionData | null,
  profile: UpperBodyRigProfileV1,
  landmarks: RawNormalizedLandmarkV1[] | null,
  curlEnabled = false,
  rotationDeltaOverride: QuaternionData | null = null,
  neutralOffsetProxy: { lateral: number; depth: number } | null = null,
): TorsoMotionResult {
  const delta = rotationDeltaOverride ?? (basis && neutralRotation ? multiplyQuaternions(inverseQuaternion(neutralRotation), basis.worldRotation) : null);
  const raw = delta && quaternionLog(delta);
  const rotation = raw && clampRotationEllipsoid(raw, LIMITS);
  const layer: UpperBodyLayer = {};
  if (rotation) {
    const names = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).filter((name) => Boolean(profile.joints[name]));
    for (const component of ["x","y","z"] as const) {
      const sum = names.reduce((value,name)=>value+WEIGHTS[name][component],0);
      if (sum <= 1e-8) continue;
      for (const name of names) {
        const semantic={x:0,y:0,z:0}; semantic[component]=rotation[component]*WEIGHTS[name][component]/sum;
        const contribution=semanticRotationToLocal(semantic,profile.joints[name]!);
        layer[name]=layer[name] ? multiplyQuaternions(layer[name]!,contribution) : contribution;
      }
    }
  }
  const measuredProxy=computeRotationOnlyTorsoOffsetProxy(landmarks,basis);
  const proxy=measuredProxy?{lateral:measuredProxy.lateral-(neutralOffsetProxy?.lateral??0),depth:measuredProxy.depth-(neutralOffsetProxy?.depth??0)}:null;
  // Curl phải qua baseline đa-model; giữ null khi flag chưa được duyệt.
  return { layer, rotation, rotationOnlyTorsoOffsetProxy: proxy, curl: curlEnabled ? 0 : null };
}
