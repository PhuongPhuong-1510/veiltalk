'use strict';
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { assert, caseTest:test, wait } = require('./support.cjs');
const requireSignaling=createRequire(resolve(__dirname,'../../signaling/package.json'));
const WebSocket=requireSignaling('ws');
const jwt=requireSignaling('jsonwebtoken');
const { createServer }=require('../../signaling/src/server');

const secret='t07-isolated-signaling-secret-12345678901234567890';
const userA='a310fc8c-109f-4e53-91ee-8fcd508f7512';
const userB='b420fc8c-109f-4e53-91ee-8fcd508f7513';
const token=user=>jwt.sign({type:'access',jti:randomUUID(),iat:Math.floor(Date.now()/1000),
  exp:Math.floor(Date.now()/1000)+900,sub:user,role:'user'},secret,{algorithm:'HS256',noTimestamp:true});
const message=(type,target,callId,data={})=>({type,target_user_id:target,call_id:callId,data});

function server(options={}) {
  const notify=options.callNotifyClient??{notify:async()=> 'notified'};
  const instance=createServer({port:0,jwtSecret:secret,log:()=>{},callNotifyClient:notify,
    revocationStore:{isRevoked:async()=>false},...options});
  return {...instance,port:instance.wss.address().port};
}
class Client {
  constructor(ws) {
    this.ws=ws; this.events=[];
    ws.on('message',raw=>this.events.push(JSON.parse(raw)));
  }
  send(value){this.ws.send(JSON.stringify(value));}
  async take(type,timeout=1500) {
    const end=Date.now()+timeout;
    while(Date.now()<end) {
      const index=this.events.findIndex(event=>event.type===type);
      if(index>=0)return this.events.splice(index,1)[0];
      await wait(5);
    }
    throw new Error(`Missing isolated signaling ${type}; got ${this.events.map(e=>e.type).join(',')}`);
  }
}
async function connect(port,user) {
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws/signaling?token=${encodeURIComponent(token(user))}`);
  const client=new Client(ws);
  await new Promise((ok,no)=>{ws.once('open',ok);ws.once('error',no);});
  return client;
}
async function close(instance,...clients) {
  for(const client of clients) client?.ws.terminate();
  for(const socket of instance.wss.clients) socket.terminate();
  await instance.stop();
}

test('T07-CALL-006',async()=>{
  const s=server({sessionTimeoutMs:250,sessionSweepIntervalMs:10});
  const a=await connect(s.port,userA),b=await connect(s.port,userB);
  try {
    const before=randomUUID();
    a.send(message('CALL_OFFER',userB,before,{sdp:'before-deadline'}));
    await b.take('CALL_OFFER');
    await wait(180);
    b.send(message('CALL_ANSWER',userA,before,{sdp:'answer'}));
    assert.equal((await a.take('CALL_ANSWER')).call_id,before);
    await wait(150);
    assert.equal(a.events.some(event=>event.type==='CALL_END'&&event.call_id===before),false);
    a.send(message('CALL_END',userB,before));
    await b.take('CALL_END');

    const after=randomUUID();
    a.send(message('CALL_OFFER',userB,after,{sdp:'after-deadline'}));
    await b.take('CALL_OFFER');
    const timedOut=await a.take('CALL_END',1000);
    assert.equal(timedOut.call_id,after);
    assert.equal(timedOut.data.reason,'timeout');
    b.send(message('CALL_ANSWER',userA,after,{sdp:'late'}));
    assert.equal((await b.take('ERROR')).data.code,'INVALID_CALL_SESSION');
  } finally { await close(s,a,b); }
});

test('T07-CALL-009',async()=>{
  let releaseNotify,notifyStarted;
  const started=new Promise(resolve=>{notifyStarted=resolve;});
  const notify={notify:async()=>{notifyStarted();return new Promise(resolve=>{releaseNotify=()=>resolve('notified');});}};
  const s=server({callNotifyClient:notify});
  const a=await connect(s.port,userA); let b;
  try {
    const callId=randomUUID();
    a.send(message('CALL_OFFER',userB,callId,{sdp:'registration-race'}));
    await started;
    b=await connect(s.port,userB);
    assert.equal((await b.take('CALL_OFFER')).call_id,callId);
    releaseNotify();
    await wait(150);
    assert.equal(b.events.filter(event=>event.type==='CALL_OFFER'&&event.call_id===callId).length,0,
      'Callee received a duplicate offer when registration crossed notify completion');
  } finally { releaseNotify?.(); await close(s,a,b); }
});

test('T07-CALL-011',async()=>{
  const first=server(),a1=await connect(first.port,userA),b1=await connect(first.port,userB);
  const stale=randomUUID();
  a1.send(message('CALL_OFFER',userB,stale));
  await b1.take('CALL_OFFER');
  await close(first,a1,b1);

  const second=server(),a2=await connect(second.port,userA),b2=await connect(second.port,userB);
  try {
    b2.send(message('CALL_ANSWER',userA,stale));
    assert.equal((await b2.take('ERROR')).data.code,'INVALID_CALL_SESSION');
    const fresh=randomUUID();
    a2.send(message('CALL_OFFER',userB,fresh));
    assert.equal((await b2.take('CALL_OFFER')).call_id,fresh);
  } finally { await close(second,a2,b2); }
});

test('T07-CALL-012',async()=>{
  let outcome='failed';
  const s=server({callNotifyClient:{notify:async()=>outcome}});
  const a=await connect(s.port,userA),b=await connect(s.port,userB);
  try {
    a.send(message('CALL_OFFER',userB,randomUUID()));
    assert.equal((await a.take('ERROR')).data.code,'TARGET_OFFLINE');
    assert.equal(b.events.some(event=>event.type==='CALL_OFFER'),false);
    assert.equal(s.callSessionsByUserId.size,0);
    outcome='notified';
    const recovered=randomUUID();
    a.send(message('CALL_OFFER',userB,recovered));
    assert.equal((await b.take('CALL_OFFER')).call_id,recovered);
  } finally { await close(s,a,b); }
});
