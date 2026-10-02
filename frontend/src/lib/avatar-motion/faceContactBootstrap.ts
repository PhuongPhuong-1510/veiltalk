/** Resample people, keeping all their sessions/clips together; never resample correlated frames. */
export function bootstrapFaceContactSubjects(rows:Array<{subjectId:string;tp:number;fp:number;fn:number;abstainedPositive:number}>,seed=42,replicates=2000){
  if(!Number.isInteger(replicates)||replicates<100||replicates>10000)throw new Error("Bootstrap requires 100–10000 replicates.");
  const groups=new Map<string,{tp:number;fp:number;fn:number}>();
  for(const row of rows){if(!row.subjectId||![row.tp,row.fp,row.fn,row.abstainedPositive].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error("Invalid subject counts.");const g=groups.get(row.subjectId)??{tp:0,fp:0,fn:0};g.tp+=row.tp;g.fp+=row.fp;g.fn+=row.fn+row.abstainedPositive;groups.set(row.subjectId,g);}
  const subjects=[...groups.values()],precision:number[]=[],recall:number[]=[];
  if(subjects.length<5)return{subjects:subjects.length,replicates:0,precision95:null,recallIncludingAbstentions95:null,reason:"At least five independent people are required; no frame-level confidence interval."};
  let state=seed>>>0;const random=()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  for(let i=0;i<replicates;i++){let tp=0,fp=0,fn=0;for(let j=0;j<subjects.length;j++){const g=subjects[Math.floor(random()*subjects.length)];tp+=g.tp;fp+=g.fp;fn+=g.fn;}if(tp+fp)precision.push(tp/(tp+fp));if(tp+fn)recall.push(tp/(tp+fn));}
  const interval=(values:number[])=>{if(values.length<replicates*.9)return null;values.sort((a,b)=>a-b);return{low:values[Math.floor((values.length-1)*.025)],high:values[Math.ceil((values.length-1)*.975)],validReplicates:values.length};};
  return{subjects:subjects.length,seed,replicates,precision95:interval(precision),recallIncludingAbstentions95:interval(recall),reason:"Percentile bootstrap by subject, pooled counts per replicate; uncertainty remains unreliable with very few people."};
}
