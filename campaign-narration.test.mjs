import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {installCampaignNarration} from './campaign-narration.mjs';
const audioId='12345678-1234-1234-1234-123456789abc';
const narration={audioId,mode:'personal',text:'Texte',voice:'female',duration:7};
function fixture({owner=1,missing=false,stale=false,data={scenario:'Scénario',narration}}={}){
 const routes=new Map(),state={updates:0,paths:[]};
 const pool={async query(sql,args){
  if(sql.startsWith('SELECT')){assert.match(sql,/id=\$1 AND user_id=\$2/);return {rows:args[1]===owner?[{campaign_data:data}]:[]};}
  assert.match(sql,/id=\$1 AND user_id=\$2 AND COALESCE\(campaign_data->>'scenario',''\)=\$4/);state.updates++;state.saved=JSON.parse(args[2]);return {rows:stale?[]:[{id:4}]};
 }};
 installCampaignNarration({app:{get:(url,...handlers)=>routes.set('GET',handlers),patch:(url,...handlers)=>routes.set('PATCH',handlers)},pool,requireAuth(){},audioDirectory:'/media',durationOf:async file=>{state.paths.push(file);if(missing||file!==path.join('/media',`audio-${owner}-${audioId}.wav`))throw Error('missing');return 7;}});
 async function invoke(method,{user=1,body={scenario:'Scénario',...narration},id='4'}={}){const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await routes.get(method).at(-1)({user:{id:user},params:{id},body},res);return res;}
 return {invoke,state};
}
test('owner restores saved narration and canonical authenticated URL',async()=>{const f=fixture();const r=await f.invoke('GET');assert.equal(r.statusCode,200);assert.equal(r.body.narration.audioUrl,`/api/audio/${audioId}`);assert.equal(r.body.scenario,'Scénario');assert.equal(r.body.narration.duration,7);});
test('foreign campaign rejected before media lookup or update',async()=>{const f=fixture();for(const method of ['GET','PATCH'])assert.equal((await f.invoke(method,{user:2})).statusCode,404);assert.equal(f.state.paths.length,0);assert.equal(f.state.updates,0);});
test('foreign audio and traversal cannot be saved on own campaign',async()=>{const f=fixture({owner:2});assert.equal((await f.invoke('PATCH',{user:2})).statusCode,200);const missing=fixture({missing:true});assert.equal((await missing.invoke('PATCH')).statusCode,400);assert.equal(missing.state.updates,0);for(const id of ['../file','not-a-uuid'])assert.equal((await f.invoke('PATCH',{user:2,body:{scenario:'Scénario',...narration,audioId:id}})).statusCode,400);});
test('missing saved audio never marks narration ready',async()=>{assert.equal((await fixture({missing:true}).invoke('GET')).statusCode,404);assert.equal((await fixture({data:{}}).invoke('GET')).body.narration,null);});
test('save persists validated fields and clear persists null',async()=>{const f=fixture();assert.equal((await f.invoke('PATCH')).statusCode,200);assert.deepEqual(f.state.saved,narration);assert.equal((await f.invoke('PATCH',{body:{scenario:'Scénario',audioId:null}})).statusCode,200);assert.equal(f.state.saved,null);});
test('stale scenario refuses overwrite and malformed request never writes',async()=>{assert.equal((await fixture({stale:true}).invoke('PATCH')).statusCode,409);for(const bad of [{},{...narration,scenario:5},{...narration,scenario:'Scénario',text:'a'.repeat(801)},{...narration,scenario:'Scénario',voice:'invalid'}]){const f=fixture();assert.equal((await f.invoke('PATCH',{body:bad})).statusCode,400);assert.equal(f.state.updates,0);}});
test('browser restoration restores preview and avoids stale restoration after editing',async()=>{
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 const code=html.slice(html.indexOf('    async function restoreCampaignNarration()'),html.indexOf('    function invalidateAudio()'));
 for(const edited of [false,true]){
  const elements=new Map();for(const id of ['voiceMode','voiceGender','voiceNarration','autoVoiceFields','personalVoiceFields','voicePreview','voiceFeedback'])elements.set(id,{options:[{value:'female'}]});
  let resolve;const context=vm.createContext({audioRevision:0,rawScenario:'Scénario',audioBusy:false,localStorage:{getItem:()=> '4',setItem(){},removeItem(){}},voiceElement:id=>elements.get(id),voiceReady:false,preparedAudioId:'',els:{voiceBtn:{querySelector:()=>({})}},updateWorkflowState(){},fetch:async()=>await new Promise(r=>resolve=r)});
  vm.runInContext(code,context);const pending=context.restoreCampaignNarration();if(edited)context.audioRevision++;
  resolve({ok:true,json:async()=>({ok:true,scenario:'Scénario',narration:{...narration,audioUrl:`/api/audio/${audioId}`}})});await pending;
  assert.equal(context.voiceReady,!edited);if(!edited){assert.equal(elements.get('voicePreview').src,`/api/audio/${audioId}`);assert.equal(elements.get('voiceMode').value,'personal');}
 }
});
test('all inline browser scripts parse after integration',()=>{const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(!/\bsrc=|type="application\/ld\+json"/.test(match[1]))new vm.Script(match[2]);}});
