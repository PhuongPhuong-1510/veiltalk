import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { Bone, Group, Matrix4, Quaternion, Vector3, BufferGeometry, BufferAttribute, MeshBasicMaterial, Skeleton, SkinnedMesh } from 'three';

const root=fileURLToPath(new URL('../',import.meta.url)),server=await createServer({root,server:{middlewareMode:true},appType:'custom'});
const report={version:1,createdAt:new Date().toISOString(),stage:'actual-glb-skin-cpu',limitations:['Loads actual GLB geometry, skin weights, bind matrices and morphs without textures/WebGL or normalized VRM animation.','Numeric oracle checks do not establish webcam precision/recall or multi-person acceptance.'],models:[]};
try{
  const {createRigProfile}=await server.ssrLoadModule('/src/lib/avatar-renderer/modelLoader.ts');
  const {captureSemanticBoneFrames}=await server.ssrLoadModule('/src/lib/avatar-renderer/renderedContactGeometry.ts');
  const {FaceContactMesh}=await server.ssrLoadModule('/src/lib/avatar-renderer/faceContactMesh.ts');
  const {mapAvatarFaceSurface}=await server.ssrLoadModule('/src/lib/avatar-motion/avatarFaceSurface.ts');
  const {buildFingerRigProfile}=await server.ssrLoadModule('/src/lib/avatar-motion/fingerRig.ts');
  const {compareFaceContactRecording}=await server.ssrLoadModule('/src/lib/avatar-motion/faceContactEvaluation.ts');
  const {createSyntheticMotionRecording}=await server.ssrLoadModule('/src/lib/avatar-motion/syntheticMotionRecording.ts');
  for(const name of ['reference-avatar.vrm','reference-avatar-1.vrm','reference-avatar-2.vrm']){
    const bytes=await fs.readFile(path.join(root,'public/models/avatars',name)),jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8')),binary=bytes.subarray(28+jsonLength);
    const read=index=>{const a=json.accessors[index],view=json.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],types={5120:[Int8Array,'getInt8',1],5121:[Uint8Array,'getUint8',1],5122:[Int16Array,'getInt16',2],5123:[Uint16Array,'getUint16',2],5125:[Uint32Array,'getUint32',4],5126:[Float32Array,'getFloat32',4]},[Type,method,unit]=types[a.componentType];
      if(a.sparse)throw Error('Sparse accessor requires an explicit loader');const result=new Type(a.count*size),data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),offset=(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??size*unit;
      for(let i=0;i<a.count;i++)for(let j=0;j<size;j++)result[i*size+j]=data[method](offset+i*stride+j*unit,true);return new BufferAttribute(result,size,a.normalized??false);};
    const nodes=json.nodes.map((n,i)=>{const b=new Bone();b.name=n.name??`node-${i}`;if(n.matrix)new Matrix4().fromArray(n.matrix).decompose(b.position,b.quaternion,b.scale);else{if(n.translation)b.position.fromArray(n.translation);if(n.rotation)b.quaternion.fromArray(n.rotation);if(n.scale)b.scale.fromArray(n.scale);}return b;});
    json.nodes.forEach((n,i)=>n.children?.forEach(c=>nodes[i].add(nodes[c])));const scene=new Group();nodes.filter(n=>!n.parent).forEach(n=>scene.add(n));scene.updateMatrixWorld(true);
    const materials=json.materials.map(m=>{const v=new MeshBasicMaterial();v.name=m.name??'unknown';v.opacity=m.pbrMetallicRoughness?.baseColorFactor?.[3]??1;v.alphaTest=m.alphaMode==='MASK'?(m.alphaCutoff??.5):0;return v;});
    json.nodes.forEach((n,i)=>{if(n.mesh===undefined||n.skin===undefined)return;const skin=json.skins[n.skin],inverses=skin.inverseBindMatrices?read(skin.inverseBindMatrices).array:null,skeleton=new Skeleton(skin.joints.map(j=>nodes[j]),inverses?skin.joints.map((_,j)=>new Matrix4().fromArray(inverses,j*16)):undefined);
      for(const[pIndex,p]of json.meshes[n.mesh].primitives.entries()){if(p.mode!==undefined&&p.mode!==4)continue;const g=new BufferGeometry();for(const[key,attribute]of [['POSITION','position'],['JOINTS_0','skinIndex'],['WEIGHTS_0','skinWeight']])if(p.attributes[key]!==undefined)g.setAttribute(attribute,read(p.attributes[key]));if(p.indices!==undefined)g.setIndex(read(p.indices));
        if(p.targets?.length){g.morphTargetsRelative=true;g.morphAttributes.position=p.targets.map(t=>t.POSITION!==undefined?read(t.POSITION):new BufferAttribute(new Float32Array(g.getAttribute('position').count*3),3));}
        const mesh=new SkinnedMesh(g,materials[p.material]);mesh.name=`${json.meshes[n.mesh].name??'mesh'}:${pIndex}`;nodes[i].add(mesh);mesh.updateWorldMatrix(true,false);mesh.bind(skeleton,mesh.matrixWorld);if(n.weights)mesh.morphTargetInfluences=n.weights.slice();}
    });scene.updateMatrixWorld(true);
    const mapping=json.extensions?.VRMC_vrm?.humanoid?.humanBones??Object.fromEntries((json.extensions?.VRM?.humanoid?.humanBones??[]).map(b=>[b.bone,{node:b.node}])),bones=Object.fromEntries(Object.entries(mapping).map(([name,b])=>[name,nodes[b.node]]));
    if(json.extensions?.VRM)for(const side of ['left','right']){bones[side+'ThumbMetacarpal']=bones[side+'ThumbProximal'];bones[side+'ThumbProximal']=bones[side+'ThumbIntermediate'];}
    const fingerprint=createHash('sha256').update(bytes).digest('hex'),rig=createRigProfile(1,fingerprint,bones);if(!rig)throw Error('Invalid rig: '+name);
    const started=performance.now(),surface=new FaceContactMesh(scene,rig,captureSemanticBoneFrames(bones,bones)),fitMs=performance.now()-started,samples=[];
    if(surface.profile)for(const[region,uv]of [['leftCheek',{x:.45,y:.2}],['rightCheek',{x:-.45,y:.2}],['forehead',{x:0,y:-.7}],['leftCheek',{x:.8,y:-.1}]]){
      const anchor=mapAvatarFaceSurface(surface.profile,uv,region);if(!anchor){samples.push({region,uv,status:'unmapped-proxy-fallback'});continue;}const point=surface.sample(anchor.skinBinding);if(!point||!point.point.toArray().every(Number.isFinite))throw Error('Invalid skin sample: '+name);
      const old=bones.head.quaternion.clone();bones.head.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.35));scene.updateMatrixWorld(true);const posed=surface.sample(anchor.skinBinding);bones.head.quaternion.copy(old);scene.updateMatrixWorld(true);if(!posed||point.point.distanceTo(posed.point)<1e-5)throw Error('Skin sample did not follow head rotation: '+name);
      samples.push({region,uv,binding:anchor.skinBinding,restPoint:point.point.toArray(),yawDisplacement:point.point.distanceTo(posed.point)});
    }
    const metadata={rigProfile:{...rig,...(surface.profile?{faceSurface:surface.profile}:{})},fingerRig:buildFingerRigProfile(1,bones,fingerprint)};
    const benchmarks=[];for(const sceneName of ['face-cheek','face-forehead','face-temple-edge','face-near-no-contact']){const recording=createSyntheticMotionRecording(sceneName,metadata,30),result=await compareFaceContactRecording(recording,null);if(result.results.some(r=>r.nonFiniteRotations))throw Error('Nonfinite contact packet: '+name);benchmarks.push({scene:sceneName,results:result.results});}
    const skinBounds=[];scene.traverse(mesh=>{if(!(mesh instanceof SkinnedMesh)||!/skin/i.test(mesh.material.name))return;const position=mesh.geometry.getAttribute('position'),ids=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight'),headId=mesh.skeleton.bones.indexOf(bones.head),points=[];
      for(let v=0;v<position.count;v++){let weight=0;for(let j=0;j<4;j++)if(ids.getComponent(v,j)===headId)weight+=weights.getComponent(v,j);if(weight<.55)continue;const point=mesh.localToWorld(mesh.getVertexPosition(v,new Vector3())).sub(bones.head.getWorldPosition(new Vector3()));points.push([point.dot(new Vector3(...Object.values(rig.torsoReference.rightWorld))),point.dot(new Vector3(...Object.values(rig.torsoReference.upWorld))),point.dot(new Vector3(...Object.values(rig.torsoReference.forwardWorld)))]);}
      const weightCounts={};for(let v=0;v<position.count;v++)for(let j=0;j<4;j++)if(weights.getComponent(v,j)>.5){const bone=mesh.skeleton.bones[ids.getComponent(v,j)];weightCounts[bone.name]=(weightCounts[bone.name]??0)+1;}
      skinBounds.push({material:mesh.material.name,determinant:mesh.matrixWorld.determinant(),headId,count:points.length,weightsByBone:Object.entries(weightCounts).sort((a,b)=>b[1]-a[1]).slice(0,15),min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
    });
    report.models.push({name,sha256:fingerprint,capability:surface.capability,rigHead:rig.collisionReference.head,skinBounds,fitMs,samples,benchmarks});process.stdout.write(`${name}: ${surface.capability.status}, ${surface.capability.triangles} triangles, ${fitMs.toFixed(1)} ms\n`);
  }
  const directory=path.join(root,'../docs/motion-review');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'face-contact-skin-audit.json'),JSON.stringify(report,null,2));
}finally{await server.close();}
