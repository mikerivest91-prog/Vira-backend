import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {audioFile} from './audio-service.mjs';
import {clipPath} from './clip-service.mjs';
const source=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function response(){return {statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},sendStatus(n){this.statusCode=n;return this;},sendFile(file){this.file=file;return this;}};}
function route(start,end,context={}){
 let handler; const app={}; for(const method of ['get','post','put','patch','delete'])app[method]=(_url,...handlers)=>handler=handlers.at(-1);
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);
 vm.runInNewContext(source.slice(a,b),{app,requireAuth(){},console,path,...context});return handler;
}
test('audio and clip handlers never serve another owner UUID',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 for(const [marker,end,helper,dir] of [
  ['app.get("/api/audio/:id"','/* ================================\n   VIDEO PREPARE',audioFile,'AUDIO_TEMP_DIR'],
  ['app.get("/api/video/clips/:id"','app.post("/api/video/assemble-clips"',clipPath,'CLIP_TEMP_DIR']]){
  const own=helper('/media',1,id);let accessed;
  const handler=route(marker,end,{audioFile,clipPath,[dir]:'/media',fs:{promises:{access:async file=>{accessed=file;if(file!==own)throw Error('missing');}}}});
  const foreign=response();await handler({user:{id:2},params:{id}},foreign);assert.equal(foreign.statusCode,404);assert.notEqual(accessed,own);assert.equal(foreign.file,undefined);
  const owner=response();await handler({user:{id:1},params:{id}},owner);assert.equal(owner.file,own);
  for(const bad of ['../secret','../../audio-1-'+id,id+'/..']){const res=response();await handler({user:{id:1},params:{id:bad}},res);assert.equal(res.statusCode,404);}
 }
});
test('MP4 handler checks sidecar owner and refuses traversal',async()=>{
 const handler=route("app.get('/videos/:filename'",'const pool = new Pool',{
  VIDEO_STORAGE_DIR:'/media',ADMIN_EMAIL:'admin@example.invalid',normalizeEmail:s=>s.toLowerCase(),fs:{promises:{readFile:async()=>JSON.stringify({userId:'1'})}}
 });
 for(const [uid,file,expected] of [[2,'vira-test.mp4',404],[1,'../vira-test.mp4',404],[1,'vira-test.mp4',200]]){
  const res=response();await handler({user:{id:uid,email:'user@example.invalid'},params:{filename:file}},res);assert.equal(res.statusCode,expected);assert.equal(Boolean(res.file),expected===200);
 }
});
test('campaign list uses authenticated identity despite forged body',async()=>{
 const handler=route('app.get("/api/campaigns"','app.post("/api/campaigns/:id/duplicate"',{pool:{query:async(sql,args)=>{assert.match(sql,/WHERE user_id = \$1/);assert.equal(args[0],2);return {rows:[]};}}});
 const res=response();await handler({user:{id:2},body:{userId:1}},res);assert.equal(res.body.campaigns.length,0);
});
test('foreign campaign duplicate is refused before insert',async()=>{
 let calls=0;const handler=route('app.post("/api/campaigns/:id/duplicate"','app.post("/api/campaigns",',{pool:{query:async(sql,args)=>{calls++;assert.match(sql,/id=\$1 AND user_id=\$2/);assert.deepEqual(Array.from(args),[10,2]);return {rows:[]};}}});
 const res=response();await handler({user:{id:2},params:{id:'10'},body:{userId:1}},res);assert.equal(res.statusCode,404);assert.equal(calls,1);
});
test('foreign publication and deletion use owner filter and return 404',async()=>{
 for(const [start,end,pattern,argsExpected] of [
  ['app.patch("/api/campaigns/:id/publication"','app.put("/api/campaigns/:id"',/WHERE id = \$2 AND user_id = \$3/,2],
  ['app.delete("/api/campaigns/:id"','/* ================================\n   START SERVER',/AND user_id = \$2/,1]]){
  const handler=route(start,end,{pool:{query:async(sql,args)=>{assert.match(sql,pattern);assert.equal(args[argsExpected],2);return {rows:[]};}}});
  const res=response();await handler({user:{id:2},params:{id:'10'},body:{userId:1,caption:'test',hashtags:''}},res);assert.equal(res.statusCode,404);
 }
});
test('calendar create update delete reject foreign campaign or event',async()=>{
 const markers=['app.post("/api/calendar",','app.put("/api/calendar/:id"','app.delete("/api/calendar/:id"','app.get("/api/campaigns"'];
 for(let i=0;i<3;i++){
  const handler=route(markers[i],markers[i+1],{pool:{query:async(sql,args)=>{assert.match(sql,/user_id=\$/);assert.equal(args.at(-1),2);return {rows:[]};}}});
  const res=response();await handler({user:{id:2},params:{id:'10'},body:{campaignId:10,scheduledAt:'2099-01-01T12:00:00Z',platform:'Instagram',userId:1}},res);assert.equal(res.statusCode,404);
 }
});
