import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Object3D, Matrix4, Vector3,Quaternion } from 'three';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
const out = { version: 1, createdAt: new Date().toISOString(), stage: 'raw-vrm-rest-graph', limitations: [
  'Reads actual GLB humanoid bone graphs without textures or WebGL. Does not load normalized three-vrm skin rendering.',
  'Synthetic replay validates contracts and numeric behavior, not webcam accuracy, XR superiority, or contact acceptance.'
], models: [] };
try {
  const loader = await server.ssrLoadModule('/src/lib/avatar-renderer/modelLoader.ts');
  const finger = await server.ssrLoadModule('/src/lib/avatar-motion/fingerRig.ts');
  const fingertip = await server.ssrLoadModule('/src/lib/avatar-motion/fingertipContactIk.ts');
  const benchmark = await server.ssrLoadModule('/src/lib/avatar-motion/motionBenchmark.ts');
  const fixtures = await server.ssrLoadModule('/src/lib/avatar-motion/syntheticMotionRecording.ts');
  for (const name of ['reference-avatar.vrm','reference-avatar-1.vrm','reference-avatar-2.vrm']) {
    const bytes = await fs.readFile(path.join(root,'public/models/avatars',name));
    if (bytes.readUInt32LE(0)!==0x46546c67 || bytes.readUInt32LE(16)!==0x4e4f534a) throw Error('Invalid GLB: '+name);
    const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
    const nodes = json.nodes.map((node,index)=>{const object=new Object3D();object.name=node.name??`node-${index}`;
      if(node.matrix)new Matrix4().fromArray(node.matrix).decompose(object.position,object.quaternion,object.scale);
      else {if(node.translation)object.position.fromArray(node.translation);if(node.rotation)object.quaternion.fromArray(node.rotation);if(node.scale)object.scale.fromArray(node.scale);}
      return object;});
    json.nodes.forEach((node,index)=>node.children?.forEach(child=>nodes[index].add(nodes[child])));
    const modelRoot=new Object3D();nodes.filter(node=>!node.parent).forEach(node=>modelRoot.add(node));modelRoot.updateMatrixWorld(true);
    let mapping=json.extensions?.VRMC_vrm?.humanoid?.humanBones;
    if(!mapping)mapping=Object.fromEntries((json.extensions?.VRM?.humanoid?.humanBones??[]).map(bone=>[bone.bone,{node:bone.node}]));
    const bones=Object.fromEntries(Object.entries(mapping).map(([bone,ref])=>[bone,nodes[ref.node]]));
    // VRM0 names thumb proximal/intermediate/distal map to VRM1 metacarpal/proximal/distal.
    if(json.extensions?.VRM)for(const side of ['left','right']){bones[`${side}ThumbMetacarpal`]=bones[`${side}ThumbProximal`];bones[`${side}ThumbProximal`]=bones[`${side}ThumbIntermediate`];}
    const fingerprint=createHash('sha256').update(bytes).digest('hex');
    const rig=loader.createRigProfile(1,fingerprint,bones),upper=loader.createUpperBodyRigProfile(1,fingerprint,bones),fingerRig=finger.buildFingerRigProfile(1,bones,fingerprint);
    if(!rig)throw Error('Missing arm rig: '+name);
    const model={name,sha256:fingerprint,bytes:bytes.length,humanoidBones:Object.keys(bones),lengths:rig.collisionReference?.arms,palmFrames:{left:Boolean(rig.hands?.left.contactFrame),right:Boolean(rig.hands?.right.contactFrame)},fingerJoints:finger.listControllableFingerJoints(fingerRig).length,scenes:[]};
    for(const scene of ['static','overhead','partial-arm','crossing','depth','behind-head']){
      const recording=fixtures.createSyntheticMotionRecording(scene,{rigProfile:rig,upperBodyRigProfile:upper,fingerRig});
      const results=benchmark.compareMotionRecording(recording);
      if(results.some(result=>result.nonFiniteRotations>0))throw Error('Nonfinite output: '+name+'/'+scene);
      model.scenes.push({scene,results});
    }
    const probes=new Map(),sources={};
    for(const side of ['left','right'])for(const chain of fingerRig[side].chains){const probe=fingertip.buildFingertipProbe(chain,bones);if(probe){probes.set(side+':'+chain.finger,probe);sources[side+':'+chain.finger]=probe.source;}}
    model.fingertipAudit={stage:'synthetic-tip-gap-on-actual-raw-rest-bones',sources,result:null};
    const lp=probes.get('left:index'),rp=probes.get('right:index');
    if(lp&&rp){
      const hand=bones.rightHand,position=hand.position.clone(),rotation=hand.quaternion.clone();
      const palmWidth=bones.leftIndexProximal.getWorldPosition(new Vector3()).distanceTo(bones.leftLittleProximal.getWorldPosition(new Vector3()));
      const leftTip=fingertip.fingertipPosition(lp),rightTip=fingertip.fingertipPosition(rp),segment=fingerRig.left.chains.find(c=>c.finger==='index').segments.at(-1);
      const axis=new Vector3(segment.flexAxisLocal.x,segment.flexAxisLocal.y,segment.flexAxisLocal.z).applyQuaternion(lp.bone.getWorldQuaternion(new Quaternion()));
      const direction=axis.cross(leftTip.clone().sub(lp.bone.getWorldPosition(new Vector3()))).normalize();
      const shift=leftTip.clone().addScaledVector(direction,palmWidth*.12).sub(rightTip);
      hand.position.copy(hand.parent.worldToLocal(hand.getWorldPosition(new Vector3()).add(shift)));modelRoot.updateMatrixWorld(true);
      const baseline=Object.fromEntries(Object.entries(bones).map(([name,bone])=>[name,{x:bone.quaternion.x,y:bone.quaternion.y,z:bone.quaternion.z,w:bone.quaternion.w}]));
      const result=fingertip.correctFingertipContacts({rig:fingerRig,bones,probes,baseline,palmWidth,deltaSeconds:1/60,sampleAgeMs:0,intent:{version:1,sampledAtMs:0,pairs:[{left:'index',right:'index',influence:.35}]}});
      if(!Object.values(bones).every(b=>b.quaternion.toArray().every(Number.isFinite)))throw Error('Nonfinite fingertip solve: '+name);
      if(hand.quaternion.angleTo(rotation)>1e-7)throw Error('Fingertip solve changed wrist: '+name);
      model.fingertipAudit.result=result;
      hand.position.copy(position);for(const[joint,q]of Object.entries(baseline))bones[joint].quaternion.set(q.x,q.y,q.z,q.w);modelRoot.updateMatrixWorld(true);
    }
    out.models.push(model);
    process.stdout.write(`${name}: raw rig valid, ${model.fingerJoints} finger joints, ${model.scenes.length} synthetic scenes\n`);
  }
  const outputPath=path.join(root,'../docs/motion-review/rig-audit-and-synthetic-benchmark.json');
  await fs.writeFile(outputPath,JSON.stringify(out,null,2));
  process.stdout.write(`Saved ${outputPath}\n`);
} finally { await server.close(); }
