const h = require('./support.cjs');
const { assert, caseTest: tc, request: req, expect: ex, ok, uuid, iso, isUuid, isTime,
  noLeak, unchanged, user, pair, password, avatarModel, message, validMessage, video,
  validVideo, abortVideo, sql, wait } = h;

const bad = async (method, path, token, bodies, status = 400, code = 'VALIDATION_ERROR') => {
  for (const [index,body] of bodies.entries()) {
    const response=await req(method,path,token,body);
    assert.equal(response.status,status,`${method} ${path}, variant ${index+1}: HTTP ${response.status}, code=${response.data?.error?.code??'none'}`);
    if(code)assert.equal(response.data?.error?.code,code);
  }
};
const username = () => `u${uuid().replaceAll('-', '').slice(0, 20)}`;
const publicPaths = [['POST', '/auth/login', { email: 'nobody@example.com', password }],
  ['POST', '/auth/refresh', { refresh_token: 'invalid' }], ['GET', '/avatars/models']];
const protectedPaths = async () => {
  const p = await pair(), v = await video(p.a);
  const msg = await message(p.a, p.id);
  return { p, v, paths: [
    ['POST','/auth/logout',{refresh_token:p.a.refresh}],
    ['GET','/users/me'], ['PUT','/users/me',{display_name:'X'}], ['GET','/users/me/settings'],
    ['PUT','/users/me/settings',{theme:'dark'}], ['DELETE','/users/me',{password}],
    ['POST','/users/search',{email:p.b.email}], ['PUT','/avatars/me',{model_id:(await avatarModel(p.a.token)).id}],
    ['GET','/avatars/me'], ['GET',`/avatars/${p.a.id}`], ['POST','/conversations',{other_user_id:p.b.id}],
    ['GET','/conversations'], ['GET',`/conversations/${p.id}`],
    ['POST',`/conversations/${p.id}/messages`,validMessage()], ['GET',`/conversations/${p.id}/messages`],
    ['PUT',`/conversations/${p.id}/messages/${msg.body.id}`,{status:'read'}],
    ['GET','/videos'], ['GET',`/videos/${v.id}`], ['PUT',`/videos/${v.id}`,{title:'X'}],
    ['DELETE',`/videos/${v.id}`], ['POST','/videos',validVideo()],
    ['POST',`/videos/${v.id}/chunks`,{upload_id:v.upload_id,part_number:2,etag_previous:'bad'}],
    ['POST',`/videos/${v.id}/finalize`,{upload_id:v.upload_id,duration_secs:2,parts:[]}],
    ['POST',`/videos/${v.id}/abort`,{upload_id:v.upload_id}],
    ['POST','/metrics/client',{session_type:'preview',fps:30,timestamp:iso()}],
  ] };
};

tc('COM-001', async () => { for (const [m,p,b] of (await protectedPaths()).paths) ex(await req(m,p,null,b),401,'UNAUTHORIZED'); });
tc('COM-002', async () => { for (const [m,p,b] of (await protectedPaths()).paths) for (const token of ['garbage','x.y.z']) ex(await req(m,p,token,b),401,'UNAUTHORIZED'); });
tc('COM-003', async () => {
  const p=await pair(),m=await avatarModel(p.a.token),v=await video(p.a);
  await ok('PUT','/avatars/me',p.a.token,{model_id:m.id},201);
  const checks=[
    ['GET','/users/me',['id','email','display_name','created_at']],
    ['GET','/users/me/settings',['discoverable','email_notifications','theme']],
    ['GET','/avatars/me',['user_id','model_id','model_url','customizations']],
    ['GET','/conversations',['data','next_cursor','has_more']],
    ['GET',`/conversations/${p.id}`,['id','other_user','created_at','updated_at']],
    ['GET',`/conversations/${p.id}/messages`,['data','prev_cursor','has_more']],
    ['GET','/videos',['data','storage_used_bytes','storage_limit_bytes','next_cursor','has_more']],
    ['GET',`/videos/${v.id}`,['id','title','status','format','created_at']],
  ];
  for(const [method,path,fields] of checks){const r=await req(method,path,p.a.token);ex(r,200);assert.match(r.headers.get('content-type')??'',/application\/json/);for(const field of fields)assert.ok(Object.hasOwn(r.data,field),`${path}: missing ${field}`);}
  const me=await ok('GET','/users/me',p.a.token);isUuid(me.id);isTime(me.created_at);assert.equal('displayName' in me,false);
  await abortVideo(p.a,v);
});
tc('COM-004', async () => { const {p,paths}=await protectedPaths(); const targets=[...paths.filter(([,path,body])=>body!==undefined),['POST','/auth/register',{}],['POST','/auth/login',{}],['POST','/auth/refresh',{}]]; for(const [m,path] of targets) for(const raw of ['', '{', '{"x":']) ex(await req(m,path,p.a.token,raw,{raw:true,headers:{'Content-Type':'application/json'}}),400,'VALIDATION_ERROR'); });
tc('COM-005', async () => {
  const p=await pair(),m=await message(p.a,p.id),v=await video(p.a),paths=[
    ['GET','/conversations/invalid'],['GET',`/conversations/${uuid()}`],['GET',`/conversations/${p.id}/messages/${uuid()}`],
    ['POST','/conversations/invalid/messages',validMessage()],['PUT',`/conversations/${p.id}/messages/invalid`,{status:'read'}],
    ['GET','/videos/invalid'],['GET',`/videos/${uuid()}`],['GET','/avatars/invalid'],
  ];
  const failures=[];
  for(const [method,path,body] of paths){const r=await req(method,path,p.a.token,body);if(![400,404,405].includes(r.status))failures.push(`${method} ${path}: ${r.status}`);}
  assert.deepEqual(failures,[]);
  await abortVideo(p.a,v);
});
tc('COM-006', async () => { const p=await pair(),c=await user(); const responses=[
  await req('PUT','/users/me',p.a.token,{display_name:''}),await req('GET','/users/me'),
  await req('GET',`/conversations/${p.id}`,c.token),await req('GET',`/videos/${uuid()}`,p.a.token),
  await req('POST','/auth/register',null,{email:p.a.email,password,display_name:'Duplicate',username:username()}),
]; for(const r of responses){assert.equal(typeof r.data?.error?.code,'string');assert.equal(typeof r.data?.error?.message,'string');assert.equal(typeof r.data?.error?.details,'object');noLeak(r);} });
tc('COM-007', async () => { const p=await pair(),before=await ok('GET','/users/me',p.a.token),messages=sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`),videos=sql(`SELECT count(*) FROM videos WHERE user_id='${p.a.id}'`); ex(await req('PUT','/users/me',p.a.token,{display_name:''}),400);ex(await req('POST',`/conversations/${p.id}/messages`,p.a.token,{id:uuid(),content:''}),400);ex(await req('POST','/videos',p.a.token,validVideo({title:''})),400); unchanged(before,await ok('GET','/users/me',p.a.token),['display_name','email','role']);assert.equal(sql(`SELECT count(*) FROM messages WHERE conversation_id='${p.id}'`),messages);assert.equal(sql(`SELECT count(*) FROM videos WHERE user_id='${p.a.id}'`),videos); });
tc('COM-008', async () => { const p=await pair(),v=await video(p.a); for(const path of ['/users/me','/users/me/settings','/conversations',`/conversations/${p.id}`,'/videos',`/videos/${v.id}`]) assert.deepEqual(await ok('GET',path,p.a.token),await ok('GET',path,p.a.token),path); await abortVideo(p.a,v); });
tc('COM-009', async () => { const {p,paths}=await protectedPaths(),failures=[]; for(const [,path] of paths){const r=await req('PATCH',path,p.a.token,{display_name:'WRONG'});if(![404,405].includes(r.status))failures.push(`${path}: ${r.status}`);} assert.deepEqual(failures,[]);assert.notEqual((await ok('GET','/users/me',p.a.token)).display_name,'WRONG'); });
tc('COM-010', async () => { const {p,paths}=await protectedPaths(),failures=[]; for(const [method,path,body] of paths.filter(([,path,body])=>body!==undefined)) for(const type of ['text/plain','multipart/form-data']){const r=await req(method,path,p.a.token,JSON.stringify(body),{raw:true,headers:{'Content-Type':type}});if(![400,415].includes(r.status))failures.push(`${method} ${path} ${type}: ${r.status}`);}assert.deepEqual(failures,[]); });
tc('COM-011', async () => { const a=await user(),b=await user(),before=await ok('GET','/users/me',a.token); const r=await req('PUT','/users/me',a.token,{role:'admin',is_admin:true,email:b.email,password_hash:'evil',display_name:'Safe'});assert.ok([200,400].includes(r.status));unchanged(before,await ok('GET','/users/me',a.token),['role','email']);const create=await req('POST','/videos',a.token,{...validVideo(),user_id:b.id,role:'admin'});assert.ok([201,400].includes(create.status));if(create.status===201){assert.equal(sql(`SELECT user_id FROM videos WHERE id='${create.data.id}'`),a.id);await abortVideo(a,create.data);} });
tc('COM-012', async () => { const a=await user(),r=await req('PUT','/users/me',a.token,{display_name:'Tiếng Việt 👋'});ex(r,200);assert.match(r.headers.get('content-type')??'',/application\/json/);assert.equal(r.data.display_name,'Tiếng Việt 👋');const p=await pair(),m=await message(p.a,p.id,'Xin chào 👋');assert.equal(m.data.content,'Xin chào 👋'); });
tc('COM-013', async () => { const p=await pair(),v=await video(p.a);for(const path of ['/users/me','/users/me/settings','/conversations',`/conversations/${p.id}`,'/videos',`/videos/${v.id}`,`/videos/${uuid()}`])noLeak(await req('GET',path,p.a.token));await abortVideo(p.a,v); });
tc('COM-014', async () => { const a=await user();for(const [method,path,body] of [...publicPaths,['GET','/actuator/health']]){const x=await req(method,path,null,body),y=await req(method,path,'invalid.jwt.value',body);assert.equal(x.status,y.status,path);} const r=await req('POST','/auth/register',null,{email:`t04-${uuid()}@example.com`,password,display_name:'Public',username:username()});ex(r,201); });
tc('COM-015', async () => { const a=await user();for(let i=0;i<11;i++){const r=await req('POST','/users/search',a.token,{email:'absent@example.com'});if(i<10)ex(r,200);else{ex(r,429);assert.ok(r.headers.get('retry-after'));}}const b=await user(),body={session_type:'preview',fps:30,timestamp:iso()};ex(await req('POST','/metrics/client',b.token,body),204);const limited=await req('POST','/metrics/client',b.token,body);ex(limited,429);assert.ok(limited.headers.get('retry-after')); });

tc('AUTH-001', async () => { const a=await user(); const me=await ok('GET','/users/me',a.token); assert.equal(me.id,a.id); });
tc('AUTH-002', async () => { const a=await user(); ex(await req('POST','/auth/register',null,{email:a.email,password,display_name:'Again',username:username()}),409,'CONFLICT'); });
tc('AUTH-003', async () => { await bad('POST','/auth/register',null,[{password,display_name:'X'},{email:'',password,display_name:'X'},{email:'invalid',password,display_name:'X'}]); });
tc('AUTH-004', async () => { for(const p of [undefined,'','Abc1234','lowercase1','NOLOWERCASE']) { const b={email:`t04-${uuid()}@example.com`,display_name:'X'}; if(p!==undefined)b.password=p; ex(await req('POST','/auth/register',null,b),400,'VALIDATION_ERROR'); } });
tc('AUTH-005', async () => { const a=await user({password:'Abcdefg1'}); assert.ok(a.token); });
tc('AUTH-006', async () => { for(const name of [undefined,'','x'.repeat(101)]) { const b={email:`t04-${uuid()}@example.com`,password}; if(name!==undefined)b.display_name=name; ex(await req('POST','/auth/register',null,b),400,'VALIDATION_ERROR'); } const a=await user({display_name:'x'.repeat(100)}); assert.equal((await ok('GET','/users/me',a.token)).display_name.length,100); });
tc('AUTH-007', async () => { const a=await user(); const upper=a.email.toUpperCase(); const r=await req('POST','/auth/register',null,{email:upper,password,display_name:'Uppercase',username:username()}); assert.ok([201,409].includes(r.status),`Unexpected ${r.status}`); if(r.status===201) { assert.notEqual(r.data.user.id,a.id); assert.equal((await ok('POST','/auth/login',null,{email:upper,password})).user.id,r.data.user.id); } assert.equal((await ok('POST','/auth/login',null,{email:a.email,password})).user.id,a.id); });
tc('AUTH-008', async () => { const a=await user(); const r=await ok('POST','/auth/login',null,{email:a.email,password}); assert.equal(r.user.id,a.id); assert.ok(r.tokens.access_token); assert.equal(r.user.has_avatar,false); });
tc('AUTH-009', async () => { const a=await user(); const x=await req('POST','/auth/login',null,{email:a.email,password:'Wrong123!'}),y=await req('POST','/auth/login',null,{email:`${uuid()}@example.com`,password}); ex(x,401,'UNAUTHORIZED'); ex(y,401,'UNAUTHORIZED'); assert.equal(x.data.error.message,y.data.error.message); });
tc('AUTH-010', async () => { await bad('POST','/auth/login',null,[{password},{email:'bad',password},{email:'x@example.com'},{email:'x@example.com',password:''}]); });
tc('AUTH-011', async () => { const a=await user(); await ok('DELETE','/users/me',a.token,{password},204); ex(await req('POST','/auth/login',null,{email:a.email,password}),401); });
tc('AUTH-012', async () => { const a=await user(); const r=await ok('POST','/auth/refresh',null,{refresh_token:a.refresh}); assert.ok(r.access_token); assert.equal((await ok('GET','/users/me',r.access_token)).id,a.id); });
tc('AUTH-013', async () => { const a=await user(); ex(await req('POST','/auth/refresh',null,{refresh_token:'invalid'}),401); await ok('DELETE','/users/me',a.token,{password},204); ex(await req('POST','/auth/refresh',null,{refresh_token:a.refresh}),401); });
tc('AUTH-014', async () => { await bad('POST','/auth/refresh',null,[{}, {refresh_token:null},{refresh_token:''}]); ex(await req('POST','/auth/refresh',null,{refresh_token:123}),401,'UNAUTHORIZED'); });
tc('AUTH-015', async () => { const a=await user(); sql(`UPDATE refresh_tokens SET expires_at=now()-interval '1 minute' WHERE user_id='${a.id}'`); ex(await req('POST','/auth/refresh',null,{refresh_token:a.refresh}),401); });
tc('AUTH-016', async () => { const a=await user(); await ok('POST','/auth/logout',a.token,{refresh_token:a.refresh},204); ex(await req('GET','/users/me',a.token),401); ex(await req('POST','/auth/refresh',null,{refresh_token:a.refresh}),401); });
tc('AUTH-017', async () => { const a=await user(); ex(await req('POST','/auth/logout',null,{refresh_token:a.refresh}),401); ex(await req('POST','/auth/logout','invalid',{refresh_token:a.refresh}),401); assert.equal((await ok('GET','/users/me',a.token)).id,a.id); });
tc('AUTH-018', async () => { const a=await user(),b=await user(); ex(await req('POST','/auth/logout',a.token,{refresh_token:b.refresh}),401); assert.equal((await ok('GET','/users/me',b.token)).id,b.id); });
tc('AUTH-019', async () => { const a=await user(); await ok('POST','/auth/logout',a.token,{refresh_token:a.refresh},204); ex(await req('POST','/auth/refresh',null,{refresh_token:a.refresh}),401); });
tc('AUTH-020', async () => { const a=await user({role:'admin',is_admin:true}); assert.notEqual((await ok('GET','/users/me',a.token)).role,'admin'); });
tc('AUTH-021', async () => { const a=await user({display_name:"Nguyễn O'Neil 👋"}); assert.equal((await ok('GET','/users/me',a.token)).display_name,"Nguyễn O'Neil 👋"); });
tc('AUTH-022', async () => { const a=await user(),model=await avatarModel(a.token); assert.equal((await ok('POST','/auth/login',null,{email:a.email,password})).user.has_avatar,false); await ok('PUT','/avatars/me',a.token,{model_id:model.id,customizations:{}},201); assert.equal((await ok('POST','/auth/login',null,{email:a.email,password})).user.has_avatar,true); });

tc('USR-001', async () => { const a=await user(),r=await req('GET','/users/me',a.token); ex(r,200); assert.equal(r.data.id,a.id); noLeak(r); });
tc('USR-002', async () => { const a=await user(); ex(await req('PUT','/users/me',a.token,{display_name:'New name'}),200); assert.equal((await ok('GET','/users/me',a.token)).display_name,'New name'); });
tc('USR-003', async () => { const a=await user(); await ok('PUT','/users/me',a.token,{avatar_url:'https://example.com/a.png'}); const before=await ok('GET','/users/me',a.token); await ok('PUT','/users/me',a.token,{display_name:'New'}); assert.equal((await ok('GET','/users/me',a.token)).avatar_url,before.avatar_url); });
tc('USR-004', async () => { const a=await user(); await bad('PUT','/users/me',a.token,[{display_name:''},{display_name:null},{display_name:'x'.repeat(101)}]); await ok('PUT','/users/me',a.token,{display_name:'x'.repeat(100)}); assert.equal((await ok('GET','/users/me',a.token)).display_name.length,100); });
tc('USR-005', async () => { const a=await user(); await ok('PUT','/users/me',a.token,{avatar_url:'https://example.com/a.png'}); await ok('PUT','/users/me',a.token,{display_name:'Hold'}); assert.ok((await ok('GET','/users/me',a.token)).avatar_url); await ok('PUT','/users/me',a.token,{avatar_url:null}); assert.equal((await ok('GET','/users/me',a.token)).avatar_url,null); });
tc('USR-006', async () => { const a=await user(),before=await ok('GET','/users/me',a.token); await req('PUT','/users/me',a.token,{role:'admin',email:'other@example.com',password_hash:'bad'}); unchanged(before,await ok('GET','/users/me',a.token),['role','email']); });
tc('USR-007', async () => { const a=await user(),s=await ok('GET','/users/me/settings',a.token); assert.equal(typeof s.discoverable,'boolean'); assert.equal(typeof s.email_notifications,'boolean'); assert.ok(['dark','light','system'].includes(s.theme)); });
tc('USR-008', async () => { const a=await user(); await ok('PUT','/users/me/settings',a.token,{discoverable:false,email_notifications:false,theme:'dark'}); const s=await ok('GET','/users/me/settings',a.token); assert.equal(s.discoverable,false); assert.equal(s.email_notifications,false); assert.equal(s.theme,'dark'); });
tc('USR-009', async () => { const a=await user(); await ok('PUT','/users/me/settings',a.token,{theme:'dark',email_notifications:false}); await ok('PUT','/users/me/settings',a.token,{discoverable:false}); const s=await ok('GET','/users/me/settings',a.token); assert.equal(s.theme,'dark'); assert.equal(s.email_notifications,false); });
tc('USR-010', async () => { const a=await user(); for(const theme of ['dark','light','system']) assert.equal((await ok('PUT','/users/me/settings',a.token,{theme})).theme,theme); await bad('PUT','/users/me/settings',a.token,[{theme:'other'},{theme:null}]); });
tc('USR-011', async () => { const a=await user(),before=await ok('GET','/users/me/settings',a.token); for(const value of ['false',1]) { const r=await req('PUT','/users/me/settings',a.token,{discoverable:value}); assert.ok([200,400].includes(r.status)); if(r.status===400)assert.equal((await ok('GET','/users/me/settings',a.token)).discoverable,before.discoverable); } });
tc('USR-012', async () => { const a=await user(),b=await user(); await ok('PUT','/users/me/settings',b.token,{discoverable:true}); const r=await ok('POST','/users/search',a.token,{email:b.email}); assert.equal(r.found,true); assert.equal(r.user.id,b.id); assert.equal('email' in r.user,false); });
tc('USR-013', async () => { const a=await user(),b=await user(); await ok('PUT','/users/me/settings',b.token,{discoverable:false}); for(const email of [b.email,`${uuid()}@example.com`]) { const r=await ok('POST','/users/search',a.token,{email}); assert.equal(r.found,false); assert.equal(r.user,null); } });
tc('USR-014', async () => { const a=await user(); await bad('POST','/users/search',a.token,[{}, {email:''},{email:'bad'}]); });
tc('USR-015', async () => { const a=await user(),b=await user(); await ok('DELETE','/users/me',b.token,{password},204); assert.equal((await ok('POST','/users/search',a.token,{email:b.email})).found,false); });
tc('USR-016', async () => { const a=await user(); for(let i=0;i<11;i++) { const r=await req('POST','/users/search',a.token,{email:'x@example.com'}); ex(r,i===10?429:200); if(i===10)assert.ok(r.headers.get('retry-after')); } });
tc('USR-017', async () => { const a=await user(),b=await user(); for(let i=0;i<11;i++) await req('POST','/users/search',a.token,{email:'x@example.com'}); ex(await req('POST','/users/search',b.token,{email:'x@example.com'}),200); });
tc('USR-018', async () => { const a=await user(); await ok('DELETE','/users/me',a.token,{password},204); ex(await req('GET','/users/me',a.token),401); ex(await req('POST','/auth/login',null,{email:a.email,password}),401); });
tc('USR-019', async () => { const a=await user(); ex(await req('DELETE','/users/me',a.token,{}),400); ex(await req('DELETE','/users/me',a.token,{password:'Wrong123!'}),401); assert.equal((await ok('GET','/users/me',a.token)).id,a.id); });
tc('USR-020', async () => { const a=await user(),b=await user(),model=await avatarModel(a.token); await ok('PUT','/avatars/me',a.token,{model_id:model.id},201); await ok('DELETE','/users/me',a.token,{password},204); ex(await req('GET',`/avatars/${a.id}`,b.token),404); assert.equal((await ok('POST','/users/search',b.token,{email:a.email})).found,false); });

tc('AVA-001', async () => { const r=await ok('GET','/avatars/models'); assert.ok(r.models.length>0); assert.ok(r.models[0].id); });
tc('AVA-002', async () => { const a=await user(),before=await ok('GET','/avatars/models'); await ok('PUT','/avatars/me',a.token,{model_id:before.models[0].id},201); assert.deepEqual(await ok('GET','/avatars/models'),before); });
tc('AVA-003', async () => { const a=await user(); ex(await req('GET','/avatars/me',a.token),404,'NOT_FOUND'); });
tc('AVA-004', async () => { const a=await user(),model=await avatarModel(a.token); await ok('PUT','/avatars/me',a.token,{model_id:model.id,customizations:{}},201); const r=await ok('GET','/avatars/me',a.token); assert.equal(r.model_id,model.id); assert.deepEqual(r.customizations,{}); });
tc('AVA-005', async () => { const a=await user(),models=(await ok('GET','/avatars/models',a.token)).models; assert.ok(models.length>=2); await ok('PUT','/avatars/me',a.token,{model_id:models[0].id},201); const before=await ok('GET','/avatars/me',a.token); await ok('PUT','/avatars/me',a.token,{model_id:models[1].id,customizations:{}},200); const after=await ok('GET','/avatars/me',a.token); assert.equal(after.id,before.id); assert.equal(after.model_id,models[1].id); });
tc('AVA-006', async () => { const a=await user(); await bad('PUT','/avatars/me',a.token,[{}, {model_id:''},{model_id:'missing-model'}]); });
tc('AVA-007', async () => { const a=await user(),m=await avatarModel(a.token); ex(await req('PUT','/avatars/me',a.token,{model_id:m.id,model_url:'https://evil.example/model'}),400); });
tc('AVA-008', async () => { const a=await user(),m=await avatarModel(a.token); await ok('PUT','/avatars/me',a.token,{model_id:m.id,customizations:null},201); assert.deepEqual((await ok('GET','/avatars/me',a.token)).customizations,{}); });
tc('AVA-009', async () => { const a=await user(),m=await avatarModel(a.token); ex(await req('PUT','/avatars/me',a.token,{model_id:m.id,customizations:{unknown:'x'}}),400); });
tc('AVA-010', async () => { const a=await user(),m=await avatarModel(a.token); ex(await req('PUT','/avatars/me',a.token,{model_id:m.id,customizations:{outfit:'not-supported'}}),400); });
tc('AVA-011', async () => { const a=await user(),m=await avatarModel(a.token),outfit=m.outfit_options?.[0]; assert.ok(outfit,'Catalog has no outfit option'); await ok('PUT','/avatars/me',a.token,{model_id:m.id,customizations:{outfit}},201); assert.equal((await ok('GET','/avatars/me',a.token)).customizations.outfit,outfit); });
tc('AVA-012', async () => { const a=await user(),b=await user(),m=await avatarModel(b.token); await ok('PUT','/avatars/me',b.token,{model_id:m.id},201); const r=await ok('GET',`/avatars/${b.id}`,a.token); assert.equal(r.user_id,b.id); assert.equal('created_at' in r,false); });
tc('AVA-013', async () => { const a=await user(),b=await user(); ex(await req('GET',`/avatars/${b.id}`,a.token),404); ex(await req('GET',`/avatars/${uuid()}`,a.token),404); });
tc('AVA-014', async () => { const a=await user(),b=await user(),m=await avatarModel(b.token); await ok('PUT','/avatars/me',b.token,{model_id:m.id},201); await ok('DELETE','/users/me',b.token,{password},204); ex(await req('GET',`/avatars/${b.id}`,a.token),404); });

tc('CON-001', async () => { const p=await pair(); for(const x of [p.a,p.b]) assert.equal((await ok('GET',`/conversations/${p.id}`,x.token)).id,p.id); });
tc('CON-002', async () => { const p=await pair(); assert.equal((await ok('POST','/conversations',p.a.token,{other_user_id:p.b.id},200)).id,p.id); });
tc('CON-003', async () => { const p=await pair(); assert.equal((await ok('POST','/conversations',p.b.token,{other_user_id:p.a.id},200)).id,p.id); });
tc('CON-004', async () => { const a=await user(); ex(await req('POST','/conversations',a.token,{other_user_id:a.id}),400); });
tc('CON-005', async () => { const a=await user(); await bad('POST','/conversations',a.token,[{}, {other_user_id:null},{other_user_id:'invalid'}]); });
tc('CON-006', async () => { const a=await user(),b=await user(); await ok('DELETE','/users/me',b.token,{password},204); ex(await req('POST','/conversations',a.token,{other_user_id:b.id}),404); ex(await req('POST','/conversations',a.token,{other_user_id:uuid()}),404); });
tc('CON-007', async () => { const a=await user(),r=await ok('GET','/conversations',a.token); assert.deepEqual(r.data,[]); assert.equal(r.has_more,false); assert.equal(r.next_cursor,null); });
tc('CON-008', async () => { const p=await pair(); await message(p.a,p.id); const r=await ok('GET','/conversations',p.a.token); assert.equal(r.data[0].id,p.id); assert.equal(r.data[0].other_user.id,p.b.id); assert.ok(r.data[0].last_message); });
tc('CON-009', async () => { const a=await user(); for(let i=0;i<3;i++) await ok('POST','/conversations',a.token,{other_user_id:(await user()).id},201); let cursor,ids=[]; do { const r=await ok('GET',`/conversations?limit=1${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,a.token); assert.ok(r.data.length<=1); ids.push(...r.data.map(x=>x.id)); cursor=r.next_cursor; if(!r.has_more)break; } while(ids.length<5); assert.equal(new Set(ids).size,3); });
tc('CON-010', async () => { const a=await user(); for(const limit of [1,50]) ex(await req('GET',`/conversations?limit=${limit}`,a.token),200); });
tc('CON-011', async () => { const a=await user(); for(const limit of ['0','-1','51','abc','1.5']) { const r=await req('GET',`/conversations?limit=${limit}`,a.token); assert.equal(r.status,400,`limit=${limit}: HTTP ${r.status}`); assert.equal(r.data?.error?.code,'VALIDATION_ERROR'); } assert.deepEqual(await ok('GET','/conversations?limit=',a.token),await ok('GET','/conversations',a.token)); });
tc('CON-012', async () => { const a=await user(); ex(await req('GET','/conversations?cursor=corrupt',a.token),400,'VALIDATION_ERROR'); });
tc('CON-013', async () => { const a=await user(),ids=[]; for(let i=0;i<3;i++) ids.push((await ok('POST','/conversations',a.token,{other_user_id:(await user()).id},201)).id); sql(`UPDATE conversations SET updated_at=now() WHERE id IN (${ids.map(x=>`'${x}'`).join(',')})`); const seen=new Set(); let cursor; do { const r=await ok('GET',`/conversations?limit=1${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,a.token); for(const x of r.data){assert.equal(seen.has(x.id),false);seen.add(x.id);} cursor=r.next_cursor; if(!r.has_more)break; }while(seen.size<4); assert.equal(seen.size,3); });
tc('CON-014', async () => { const p=await pair(); for(const [x,other] of [[p.a,p.b],[p.b,p.a]]) { const r=await ok('GET',`/conversations/${p.id}`,x.token); assert.equal(r.other_user.id,other.id); isTime(r.created_at); } });
tc('CON-015', async () => { const p=await pair(),c=await user(),r=await req('GET',`/conversations/${p.id}`,c.token); ex(r,403,'FORBIDDEN'); assert.equal(r.raw.includes(p.b.email),false); });
tc('CON-016', async () => { const a=await user(); ex(await req('GET',`/conversations/${uuid()}`,a.token),404); const r=await req('GET','/conversations/invalid',a.token); assert.ok([400,404].includes(r.status),`malformed UUID: HTTP ${r.status}`); });
tc('CON-017', async () => { const p=await pair(),c=await user(); const x=await ok('POST','/conversations',p.b.token,{other_user_id:c.id},201); const ar=await ok('GET','/conversations',p.a.token),br=await ok('GET','/conversations',p.b.token); assert.equal(ar.data.some(z=>z.id===x.id),false); assert.equal(br.data.some(z=>z.id===x.id),true); });

tc('MSG-001', async () => { const p=await pair(),r=await message(p.a,p.id); assert.equal(r.data.sender_id,p.a.id); assert.equal((await ok('GET',`/conversations/${p.id}/messages`,p.a.token)).data.length,1); });
tc('MSG-002', async () => { const p=await pair(),m=await message(p.a,p.id); const retry=await ok('POST',`/conversations/${p.id}/messages`,p.a.token,m.body,200); assert.equal(retry.id,m.body.id); assert.equal((await ok('GET',`/conversations/${p.id}/messages`,p.a.token)).data.length,1); });
tc('MSG-003', async () => { const p=await pair(),m=await message(p.a,p.id); ex(await req('POST',`/conversations/${p.id}/messages`,p.b.token,{...m.body,content:'different sender'}),409,'CONFLICT'); });
tc('MSG-004', async () => { const a=await user(),b=await user(),c=await user(); const x=await ok('POST','/conversations',a.token,{other_user_id:b.id},201),y=await ok('POST','/conversations',a.token,{other_user_id:c.id},201),m=await message(a,x.id); ex(await req('POST',`/conversations/${y.id}/messages`,a.token,m.body),409,'CONFLICT'); });
tc('MSG-005', async () => { const p=await pair(); for(const id of [undefined,null,'bad']) { const b={content:'x',client_timestamp:iso()}; if(id!==undefined)b.id=id; ex(await req('POST',`/conversations/${p.id}/messages`,p.a.token,b),400); } });
tc('MSG-006', async () => { const p=await pair(); for(const content of [undefined,null,'','  ']) { const b={id:uuid(),client_timestamp:iso()}; if(content!==undefined)b.content=content; ex(await req('POST',`/conversations/${p.id}/messages`,p.a.token,b),400,'VALIDATION_ERROR'); } });
tc('MSG-007', async () => { const p=await pair(); await ok('POST',`/conversations/${p.id}/messages`,p.a.token,validMessage('x'.repeat(4000)),201); ex(await req('POST',`/conversations/${p.id}/messages`,p.a.token,validMessage('x'.repeat(4001))),400); });
tc('MSG-008', async () => { const p=await pair(),content="Xin chào 👋 O'Neil\nDòng 2",m=await message(p.a,p.id,content); assert.equal(m.data.content,content); assert.equal((await ok('GET',`/conversations/${p.id}/messages`,p.b.token)).data[0].content,content); });
tc('MSG-009', async () => { const p=await pair(); await bad('POST',`/conversations/${p.id}/messages`,p.a.token,[{id:uuid(),content:'X'},{id:uuid(),content:'X',client_timestamp:'bad'}]); });
tc('MSG-010', async () => { const p=await pair(); for(const minutes of [-4.9,0,4.9]) await ok('POST',`/conversations/${p.id}/messages`,p.a.token,{...validMessage(),client_timestamp:new Date(Date.now()+minutes*60000).toISOString()},201); for(const minutes of [-6,6]) ex(await req('POST',`/conversations/${p.id}/messages`,p.a.token,{...validMessage(),client_timestamp:new Date(Date.now()+minutes*60000).toISOString()}),400); });
tc('MSG-011', async () => { const p=await pair(),c=await user(); ex(await req('POST',`/conversations/${p.id}/messages`,c.token,validMessage()),403); assert.equal((await ok('GET',`/conversations/${p.id}/messages`,p.a.token)).data.length,0); });
tc('MSG-012', async () => { const a=await user(); ex(await req('POST',`/conversations/${uuid()}/messages`,a.token,validMessage()),404); const r=await req('POST','/conversations/invalid/messages',a.token,validMessage()); assert.ok([400,404].includes(r.status),`malformed UUID: HTTP ${r.status}`); });
tc('MSG-013', async () => { const p=await pair(),m=await message(p.a,p.id,'original'); const r=await ok('POST',`/conversations/${p.id}/messages`,p.a.token,{...m.body,content:'changed'},200); assert.equal(r.content,'original'); });
tc('MSG-014', async () => { const p=await pair(),r=await ok('GET',`/conversations/${p.id}/messages`,p.a.token); assert.deepEqual(r.data,[]); assert.equal(r.has_more,false); assert.equal(r.prev_cursor,null); });
tc('MSG-015', async () => { const p=await pair(); for(let i=0;i<31;i++) await message(p.a,p.id,`m${i}`); assert.equal((await ok('GET',`/conversations/${p.id}/messages`,p.b.token)).data.length,30); });
tc('MSG-016', async () => { const p=await pair(); for(let i=0;i<101;i++) await message(p.a,p.id,`m${i}`); const seen=new Set(); let cursor; do { const r=await ok('GET',`/conversations/${p.id}/messages?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,p.b.token); for(const m of r.data){assert.equal(seen.has(m.id),false);seen.add(m.id);} cursor=r.prev_cursor; if(!r.has_more)break; }while(seen.size<102); assert.equal(seen.size,101); });
tc('MSG-017', async () => { const p=await pair(); for(const limit of ['0','-1','101','abc','1.5']) ex(await req('GET',`/conversations/${p.id}/messages?limit=${limit}`,p.a.token),400); });
tc('MSG-018', async () => { const p=await pair(); ex(await req('GET',`/conversations/${p.id}/messages?cursor=invalid`,p.a.token),400); });
tc('MSG-019', async () => { const p=await pair(),timestamp=iso(); for(let i=0;i<4;i++) await ok('POST',`/conversations/${p.id}/messages`,p.a.token,{...validMessage(`m${i}`),client_timestamp:timestamp},201); const first=await ok('GET',`/conversations/${p.id}/messages?limit=2`,p.a.token),second=await ok('GET',`/conversations/${p.id}/messages?limit=2&cursor=${encodeURIComponent(first.prev_cursor)}`,p.a.token); assert.equal(new Set([...first.data,...second.data].map(x=>x.id)).size,4); });
tc('MSG-020', async () => { const p=await pair(),c=await user(); await message(p.a,p.id,'secret content'); const r=await req('GET',`/conversations/${p.id}/messages`,c.token); ex(r,403); assert.equal(r.raw.includes('secret content'),false); });
tc('MSG-021', async () => { const p=await pair(),m=await message(p.a,p.id); const r=await ok('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'delivered'}); assert.equal(r.status,'delivered'); assert.equal(sql(`SELECT status FROM messages WHERE id='${m.body.id}'`),'delivered'); });
tc('MSG-022', async () => { const p=await pair(),m=await message(p.a,p.id); await ok('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'delivered'}); assert.equal((await ok('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'read'})).status,'read'); });
tc('MSG-023', async () => { const p=await pair(),m=await message(p.a,p.id); await ok('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'read'}); assert.equal((await ok('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'read'})).status,'read'); });
tc('MSG-024', async () => { const p=await pair(),m=await message(p.a,p.id); await ok('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'read'}); ex(await req('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,{status:'delivered'}),400); assert.equal(sql(`SELECT status FROM messages WHERE id='${m.body.id}'`),'read'); });
tc('MSG-025', async () => { const p=await pair(),m=await message(p.a,p.id); await bad('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.b.token,[{}, {status:null},{status:'bad'}]); });
tc('MSG-026', async () => { const p=await pair(),m=await message(p.a,p.id); ex(await req('PUT',`/conversations/${p.id}/messages/${m.body.id}`,p.a.token,{status:'read'}),403); });
tc('MSG-027', async () => { const p=await pair(),c=await user(),m=await message(p.a,p.id); ex(await req('PUT',`/conversations/${p.id}/messages/${m.body.id}`,c.token,{status:'read'}),403); });
tc('MSG-028', async () => { const a=await user(),b=await user(),c=await user(),x=await ok('POST','/conversations',a.token,{other_user_id:b.id},201),y=await ok('POST','/conversations',a.token,{other_user_id:c.id},201),m=await message(a,x.id); const r=await req('PUT',`/conversations/${y.id}/messages/${m.body.id}`,c.token,{status:'read'}); assert.ok([403,404].includes(r.status)); });
tc('MSG-029', async () => { const p=await pair(); ex(await req('PUT',`/conversations/${p.id}/messages/${uuid()}`,p.b.token,{status:'read'}),404); });
