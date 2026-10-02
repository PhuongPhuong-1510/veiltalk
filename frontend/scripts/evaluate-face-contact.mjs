import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const [replayPath,labelsPath,outputPath]=process.argv.slice(2);
if(!replayPath||!outputPath)throw Error('Usage: npm run contact:evaluate -- replay.json labels.json|- output.json');
const root=fileURLToPath(new URL('../',import.meta.url)),server=await createServer({root,server:{middlewareMode:true},appType:'custom'});
try{
  const {parseMotionRecording}=await server.ssrLoadModule('/src/lib/avatar-motion/motionReplay.ts'),{parseFaceContactAnnotations,compareFaceContactRecording}=await server.ssrLoadModule('/src/lib/avatar-motion/faceContactEvaluation.ts');
  const recording=parseMotionRecording(await fs.readFile(replayPath,'utf8')),labels=labelsPath==='-'?null:parseFaceContactAnnotations(await fs.readFile(labelsPath,'utf8'));
  const result=await compareFaceContactRecording(recording,labels);await fs.writeFile(outputPath,JSON.stringify(result,null,2));process.stdout.write(`Saved ${result.results.length} variants to ${outputPath}; labelled people: ${labels?1:0}\n`);
}finally{await server.close();}
