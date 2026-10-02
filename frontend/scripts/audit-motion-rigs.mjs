import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Object3D, Matrix4 } from 'three';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
const out = { version: 1, createdAt: new Date().toISOString(), stage: 'raw-vrm-rest-graph', limitations: [
  'Reads actual GLB humanoid bone graphs without textures or WebGL. Does not load normalized three-vrm skin rendering.',
  'Synthetic replay validates contracts and numeric behavior, not webcam accuracy, XR superiority, or contact acceptance.'
], models: [] };
try {
  const loader = await server.ssrLoadModule('/src/lib/avatar-renderer/modelLoader.ts');
  const finger = await server.ssrLoadModule('/src/lib/avatar-motion/fingerRig.ts');
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
    out.models.push(model);
    process.stdout.write(`${name}: raw rig valid, ${model.fingerJoints} finger joints, ${model.scenes.length} synthetic scenes\n`);
  }
  const outputPath=path.join(root,'../docs/motion-review/rig-audit-and-synthetic-benchmark.json');
  await fs.writeFile(outputPath,JSON.stringify(out,null,2));
  process.stdout.write(`Saved ${outputPath}\n`);
} finally { await server.close(); }
