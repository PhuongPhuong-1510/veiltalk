import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
async function walk(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())await walk(target);else if(/\.(ts|tsx|css|json)$/.test(entry.name))files.push(target);}}
await walk(path.join(root,'src'));const sourceHash=createHash('sha256');
for(const file of files.sort())sourceHash.update(path.relative(path.join(root,'src'),file).replaceAll('\\','/')).update('\0').update(await fs.readFile(file)).update('\0');
const assets=[];for(const name of ['models/face_landmarker.task','models/hand_landmarker.task','models/pose_landmarker_full.task','models/pose_landmarker_lite.task','wasm/vision_wasm_internal.wasm','wasm/vision_wasm_nosimd_internal.wasm']){const bytes=await fs.readFile(path.join(root,'public/mediapipe',name));assets.push({path:'public/mediapipe/'+name,bytes:bytes.length,sha256:hash(bytes)});}
const packages={};for(const name of ['@mediapipe/tasks-vision','@pixiv/three-vrm','three','typescript','vite','vitest'])packages[name]=JSON.parse(await fs.readFile(path.join(root,'node_modules',name,'package.json'),'utf8')).version;
const topologyLine=(await fs.readFile(path.join(root,'src/lib/avatar-motion/faceContactTopology.ts'),'utf8')).split('\n').find(line=>line.startsWith('export const FACE_TOPOLOGY_SOURCE'));
const topology=JSON.parse(topologyLine.slice(topologyLine.indexOf('=')+1,topologyLine.lastIndexOf(' as const')).trim());
const report={version:1,createdAt:new Date().toISOString(),experimentVersion:'face-contact-v1-2026-10-02',gitBase:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceSha256:sourceHash.digest('hex'),hashScope:'all src ts/tsx/css/json files, same algorithm as VITE_MOTION_SOURCE_HASH; hashes identify a dirty working tree, not a commit',packageLockSha256:hash(await fs.readFile(path.join(root,'package-lock.json'))),node:process.version,packages,machine:{platform:os.platform(),arch:os.arch(),cpu:os.cpus()[0]?.model,logicalProcessors:os.cpus().length},topology,assets,webcamAcceptance:'not performed',browserSmoke:'unavailable in this session',researchClaims:'No measured webcam accuracy, learned calibration or acceptance threshold passed without labelled recordings.'};
const output=path.join(root,'../docs/motion-review/face-contact-implementation-manifest.json');await fs.writeFile(output,JSON.stringify(report,null,2));process.stdout.write(`Saved source/model provenance: ${output}\n`);
