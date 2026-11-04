import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import {createResourceProtection,ownedMediaBytes,resourceLimits} from './resource-protection.mjs';
const MB=1024*1024;
class Response extends EventEmitter {
  locals={};statusCode=200;destroyed=false;
  set(){return this;}status(code){this.statusCode=code;return this;}
  json(body){this.body=body;this.emit('finish');return this;}
}
function poolFixture({acquired=true,rows=[],fail=false}={}){
 const state={released:0,unlocked:0,inserts:0,rollbacks:0};
 const db={release(){state.released++;},async query(sql){
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired}]};
  if(sql.includes('pg_advisory_unlock'))state.unlocked++;
  if(sql.startsWith('SELECT user_id')){if(fail)throw Error('db unavailable');return {rows};}
  if(sql.startsWith('INSERT INTO olyvex_voice'))state.inserts++;
  if(sql==='ROLLBACK')state.rollbacks++;
  return {rows:[]};
 }};
 return {state,pool:{connect:async()=>db}};
}
const diskIo={readdir:async()=>[],statfs:async()=>({bavail:2000,bsize:MB}),stat:async()=>({size:1}),unlink:async()=>{}};
const request=()=>({path:'/api/audio/upload',method:'POST',user:{id:1},setTimeout(){}});

test('voice limits reject user and global exhaustion before reservation',async()=>{
 for(const rows of [[{user_id:1,requests:20}],[{user_id:0,requests:100}]]){
  const f=poolFixture({rows});const protection=createResourceProtection({pool:f.pool,storage:'unused',temporaryStorage:'unused',env:{}});
  assert.equal(await protection.reserveVoice(1),false);assert.equal(f.state.inserts,0);assert.equal(f.state.rollbacks,1);assert.equal(f.state.released,1);
 }
 const f=poolFixture();assert.equal(await createResourceProtection({pool:f.pool,env:{}}).reserveVoice(1),true);assert.equal(f.state.inserts,1);
});
test('voice accounting fails closed on database failure',async()=>{
 const f=poolFixture({fail:true});await assert.rejects(createResourceProtection({pool:f.pool,env:{}}).reserveVoice(1));assert.equal(f.state.inserts,0);assert.equal(f.state.rollbacks,1);assert.equal(f.state.released,1);
});
test('limits cannot be disabled with invalid configuration',()=>{
 assert.equal(resourceLimits({VOICE_DAILY_LIMIT:'0',MEDIA_STORAGE_LIMIT_MB:'-1'}).voicePerUser,20);
 assert.equal(resourceLimits({}).storageBytes,200*MB);
});
test('storage accounting separates owners and includes final exports',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'olyvex-quota-'));
 try{
  await fs.mkdir(path.join(dir,'.audio'));await fs.mkdir(path.join(dir,'.clips'));
  await fs.writeFile(path.join(dir,'.audio','audio-1-test.wav'),Buffer.alloc(3));
  await fs.writeFile(path.join(dir,'.clips','clip-2-test.mp4'),Buffer.alloc(50));
  await fs.writeFile(path.join(dir,'vira-one.mp4'),Buffer.alloc(7));
  await fs.writeFile(path.join(dir,'vira-one.mp4.owner.json'),JSON.stringify({userId:'1'}));
  assert.equal(await ownedMediaBytes(dir,1),10);assert.equal(await ownedMediaBytes(dir,2),50);
  await assert.rejects(ownedMediaBytes(dir,'../1'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('storage guard rejects concurrent work and low disk before handler execution',async()=>{
 for(const kind of ['busy','disk']){
  const f=poolFixture({acquired:kind!=='busy'});const res=new Response();let next=0;
  const io={...diskIo,...(kind==='disk'?{statfs:async()=>({bavail:1,bsize:MB})}:{})};
  await createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io}).media(request(),res,()=>next++);
  assert.equal(next,0);assert.equal(res.statusCode,kind==='busy'?429:507);assert.equal(f.state.released,1);
 }
});
test('oversized new media is rejected and removed without deleting existing media',async()=>{
 const f=poolFixture();const res=new Response();const removed=[];
 const io={...diskIo,stat:async()=>({size:201*MB}),unlink:async filename=>removed.push(filename)};
 await createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io}).media(request(),res,()=>{});
 await assert.rejects(res.locals.acceptMedia(['new.wav']),{code:'STORAGE_QUOTA'});assert.deepEqual(removed,['new.wav']);await res.locals.releaseMedia();assert.equal(f.state.unlocked,1);
});
test('disconnect does not unlock a media job that is still processing',async()=>{
 const f=poolFixture();const res=new Response();const req=request();
 const guard=createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io:diskIo});
 await guard.media(req,res,()=>{});
 let finish;const pending=guard.run(async()=>await new Promise(resolve=>finish=resolve))(req,res);
 res.emit('close');assert.equal(f.state.released,0);finish();await pending;
 assert.equal(f.state.unlocked,1);assert.equal(f.state.released,1);res.emit('finish');await res.locals.releaseMedia();assert.equal(f.state.released,1);
});
test('legacy multipart assembly respects monthly quota before publishing',async()=>{
 const source=(await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 const start=source.indexOf('app.post(\n  "/api/video/assemble"');const end=source.indexOf('app.post("/api/video/import-clip"',start);
 let handler,published=0,cleaned=0;
 const context={app:{post:(_route,...handlers)=>{handler=handlers.at(-1);}},requireAuth:()=>{},uploadVideoClips:{array:()=>()=>{}},
  resourceProtection:{run:fn=>fn},validatedExport:async()=>({format:'portrait'}),AUDIO_TEMP_DIR:'test',reserveVideoSlot:async()=>({ok:false}),publishVideo:async()=>{published++;},
  fs:{promises:{unlink:async()=>cleaned++}},path,console};
  vm.runInNewContext(source.slice(start,end),context);
  const res=new Response();await handler({user:{id:1},files:[1,2,3,4].map(i=>({path:'test-'+i}))},res);
  assert.equal(res.statusCode,429);assert.equal(published,0);assert.equal(cleaned,4);
});
test('unauthenticated media requests cannot acquire resources',async()=>{
 const f=poolFixture();const res=new Response();let next=0;
 await createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io:diskIo}).media({...request(),user:null},res,()=>next++);
 assert.equal(res.statusCode,401);assert.equal(next,0);assert.equal(f.state.released,0);
});
test('existing full storage refuses new uploads before processing',async()=>{
 const f=poolFixture();const res=new Response();let next=0;
 const io={...diskIo,readdir:async directory=>directory.endsWith('.audio')?[{name:'audio-1-existing.wav',isFile:()=>true}]:[],stat:async()=>({size:200*MB})};
 await createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io}).media(request(),res,()=>next++);
 assert.equal(res.statusCode,413);assert.equal(next,0);assert.equal(f.state.unlocked,1);
});
test('filesystem failure refuses work and releases the lease',async()=>{
 const f=poolFixture();const res=new Response();
 const io={...diskIo,statfs:async()=>{throw Error('disk unavailable');}};
 await createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io}).media(request(),res,()=>assert.fail('must refuse work'));
 assert.equal(res.statusCode,503);assert.equal(f.state.released,1);
});
test('handler errors still release the media lease',async()=>{
 const f=poolFixture();const res=new Response();const req=request();
 const guard=createResourceProtection({pool:f.pool,storage:'test',temporaryStorage:'test',env:{},io:diskIo});
 await guard.media(req,res,()=>{});
 await assert.rejects(guard.run(async()=>{throw Error('processing failed');})(req,res));
 assert.equal(f.state.released,1);assert.equal(f.state.unlocked,1);
});
