'use strict';
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const base=__dirname;
const spec=readFileSync(resolve(base,'VEILTALK_T07_RELIABILITY_CONCURRENCY_TEST_CASES.md'),'utf8');
const cases=[...spec.matchAll(/^#### (T07-[A-Z]+-\d{3}) — (.+?) \[(P[012])\]$/gm)]
 .map(([,id,title,priority])=>({id,title,priority}));
if(cases.length!==178) throw Error(`T07 spec drift: expected 178 cases, found ${cases.length}`);
const identifiers=new Set(cases.map(x=>x.id));
const decode=value=>(value??'').replaceAll('&quot;','"').replaceAll('&apos;',"'")
 .replaceAll('&#10;',' ').replaceAll('&#13;',' ').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
function writeReport(path = resolve(base,'results/latest')) {
const xmlPath=resolve(path,'results.xml');
const dir=resolve(xmlPath,'..');
mkdirSync(dir,{recursive:true});
const xml=existsSync(xmlPath)?readFileSync(xmlPath,'utf8'):'';
const manifestPath=resolve(dir,'run.json');
const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
const found=new Map();
for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
 const [,attributes,body='']=match;
 const name=attributes.match(/\bname="([^"]+)"/)?.[1];
 const id=name?.match(/^(T07-[A-Z]+-\d{3})$/)?.[1];
 if(!id) continue;
 if(!identifiers.has(id))throw Error(`JUnit case not in T07 spec: ${id}`);
 if(found.has(id))throw Error(`Duplicate JUnit case: ${id}`);
 const skipped=/<skipped\b/.test(body);
 const failureTag=body.match(/<(?:failure|error)\b([^>]*)>/);
 const message=decode(failureTag?.[1].match(/\bmessage="([^"]*)"/)?.[1]);
 found.set(id,{status:skipped||failureTag?'FAIL':'PASS',reason:skipped?'Test was skipped':message||null});
}
const allEvidenceSafe=manifest?.cleanup?.verified===true && manifest?.devIsolation?.verified===true && manifest?.artifactScan?.verified===true;
const outputs=cases.map(item=>{
 const result=found.get(item.id)??{status:'FAIL',reason:'TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result'};
 if(result.status==='PASS'&&!allEvidenceSafe) return {...item,status:'FAIL',classification:'FAIL_ENV',reason:'Environment/cleanup/artifact evidence gate failed'};
 const testFailure=result.reason?.startsWith('CAPABILITY_MISSING:')
  || result.reason?.startsWith('TEST_NOT_EXECUTED:');
 const classification=result.status==='PASS'?'PASS':testFailure?'FAIL_TEST':'FAIL_PRODUCT';
 return {...item,...result,classification};
});
const totals={};
for(const item of outputs)totals[item.status]=(totals[item.status]||0)+1;
const classificationTotals={};
for(const item of outputs)classificationTotals[item.classification]=(classificationTotals[item.classification]||0)+1;
const line=['# T07 results — binary execution report', '',
 `- Run: ${manifest?.runId??'NOT_RUN'}, exit: ${manifest?.exitCode??'not started'}`,
 `- Environment/cleanup/artifact gate: ${allEvidenceSafe?'VERIFIED':'NOT VERIFIED'}`,
 `- Spec: **178** cases. Counts: ${Object.entries(totals).map(([k,v])=>`${k} ${v}`).join(' · ')}`,
 `- Executed assertions: **${found.size}**. Missing JUnit evidence: **${cases.length-found.size}**.`,
 `- Classification: ${Object.entries(classificationTotals).map(([k,v])=>`${k} ${v}`).join(' · ')}`,
 '- `PASS`: executable assertion completed successfully and the environment evidence gate passed.',
 '- `FAIL_PRODUCT`: executable product assertion failed.',
 '- `FAIL_TEST`: the required deterministic harness capability is not implemented yet; this is not evidence of a backend defect.',
 '- `FAIL_ENV`: isolation/cleanup/artifact evidence failed.',
 '- All 178 specification IDs are binary; there are no NOT_RUN/NEEDS_HOOK/NEEDS_CONTRACT states in this report.',
 '', '| Case | Priority | Result | Classification | Scenario | Reason |', '|---|---|---|---|---|---|',
 ...outputs.map(item=>`| ${item.id} | ${item.priority} | ${item.status} | ${item.classification} | ${item.title.replaceAll('|','\\|')} | ${(item.reason??'').replaceAll('|','\\|').replaceAll(/\s+/g,' ').slice(0,300)} |`),''];
writeFileSync(resolve(dir,'RESULTS.md'),line.join('\n'));
writeFileSync(resolve(dir,'case-status.json'),JSON.stringify({runId:manifest?.runId??null,evidenceSafe:allEvidenceSafe,
 executed:found.size,missingEvidence:cases.length-found.size,totals,classificationTotals,cases:outputs},null,2));
console.log({cases:outputs.length,executed:found.size,missingEvidence:cases.length-found.size,
 totals,classificationTotals,evidenceSafe:allEvidenceSafe});
}
exports.writeReport=writeReport;
if(require.main===module)writeReport(process.argv[2]);
