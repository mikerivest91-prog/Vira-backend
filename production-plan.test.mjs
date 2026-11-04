import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import crypto from 'node:crypto';
import './script-model.js';
import {buildProductionPlan,quoteProduction,installProductionPlan} from './production-plan.mjs';
import {inspectProductionMedia} from './production-media.mjs';
const script={title:'Ma campagne',objective:'Visites',target:'Adultes',hook:'Découvrez notre offre',publication:'Bienvenue',hashtags:'#Local',narration:'Visitez notre boutique.',cta:'Visiter',visualPrompt:'Photo',style:'Amical',scenes:['Un','Deux','Trois','Quatre']};
const data={scenario:globalThis.olyvexScriptModel.serialize(script),brand:{name:'Ma marque'},narration:{audioId:'12345678-1234-1234-1234-123456789abc',mode:'personal'},videoUrl:'/videos/vira-test.mp4'};
const facts={credits:{videos:{remaining:2},images:{remaining:8}},features:{aiImages:true,automaticVoice:true,automaticCaptions:true}};
function plan(media={visuals:true,voice:true,video:false},override={}){return buildProductionPlan({campaign:{id:1,title:'Ma campagne',campaign_data:data},facts:{...facts,...override},media});}
test('guide follows saved scenario, visuals and actual voice readiness',()=>{
 assert.equal(plan({visuals:false,voice:false,video:false}).next,'visuals');assert.equal(plan({visuals:true,voice:false,video:false}).next,'voice');assert.equal(plan().next,'export');assert.equal(plan({visuals:true,voice:true,video:true}).next,'download');assert.equal(plan().brandName,'Ma marque');
 const invalid=buildProductionPlan({campaign:{id:1,campaign_data:{scenario:'Invalid'}},facts,media:{visuals:true,voice:true,video:false}});assert.equal(invalid.next,'script');assert.equal(invalid.steps[1].ready,false);
});
test('existing owned export stays downloadable even if source media has expired',()=>{
 const r=plan({visuals:false,voice:false,video:true});assert.equal(r.next,'download');assert.equal(r.videoUrl,'/videos/vira-test.mp4');assert.equal(quoteProduction(r,'video').available,false);
});
test('quotes use fixed media costs and fail closed for missing or insufficient balances',()=>{
 assert.deepEqual(quoteProduction(plan(),'images').credits,{images:4,videos:0});assert.deepEqual(quoteProduction(plan(),'video').credits,{images:0,videos:1});assert.equal(quoteProduction(plan(),'voice').dailyVoiceLimit,true);assert.equal(quoteProduction(plan(),'captions').mayReuseCache,true);
 assert.equal(quoteProduction(plan(undefined,{credits:null}),'video').available,false);assert.equal(quoteProduction(plan(undefined,{credits:{videos:{remaining:0},images:{remaining:3}}}),'images').available,false);assert.throws(()=>quoteProduction(plan(),'arbitrary'));
});
test('disabled generation offers import guidance and cannot be quoted as available',()=>{
 const r=quoteProduction(plan(undefined,{features:{aiImages:false,automaticVoice:false,automaticCaptions:false}}),'images');assert.equal(r.available,false);assert.match(r.reason,/Importez/);
 assert.equal(quoteProduction(plan({visuals:true,voice:false,video:false}),'video').available,false);
});
test('reusing an existing image job does not require four more image credits',()=>{
 const r=quoteProduction(plan(undefined,{credits:{images:{remaining:0},videos:{remaining:2}}}),'images',{existingImageJob:true});assert.equal(r.available,true);assert.equal(r.credits.images,0);assert.equal(r.existingImageJob,true);
});
test('media inspector checks owner sidecar, actual clip/audio paths and rejects traversal',async()=>{
 const seen=[];const options={audioDirectory:'C:/audio',clipDirectory:'C:/clips',videoDirectory:'C:/videos',decodeImage:value=>{if(value!=='valid')throw Error();},durationOf:async filename=>{seen.push(filename);return 6;},io:{readFile:async()=>JSON.stringify({userId:'1'}),stat:async()=>({isFile:()=>true,size:10})},clipReader:async()=>({duration:2})};
 const ready=await inspectProductionMedia({...data,generatedImages:Array(4).fill('valid')},1,options);assert.deepEqual(ready,{visuals:true,voice:true,video:true});assert.ok(seen[0].includes('audio-1-'));
 const denied=await inspectProductionMedia({...data,sourceClips:[{id:'x'},{id:'x'},{id:'x'},{id:'x'}]},2,{...options,clipReader:async()=>{throw Error('expired');},durationOf:async()=>{throw Error('expired');}});assert.deepEqual(denied,{visuals:false,voice:false,video:false});
 const traversal=await inspectProductionMedia({videoUrl:'/videos/../secret.mp4'},1,{...options,io:{readFile:async()=>{throw Error('must not read');}}});assert.equal(traversal.video,false);
});
test('custom narration text remains usable when its saved audio exists',async()=>{
 const media=await inspectProductionMedia({...data,narration:{...data.narration,mode:'auto',text:'Custom narration selected by client'}},1,{audioDirectory:'C:/audio',clipDirectory:'C:/clips',videoDirectory:'C:/videos',decodeImage(){},durationOf:async()=>6,io:{readFile:async()=>{throw Error();}}});assert.equal(media.voice,true);
});
test('plan and quote endpoints refuse foreign campaigns before subscription checks and never reserve credits',async()=>{
 const db=new PGlite(),handlers={},queries=[];await db.exec('CREATE TABLE vira_campaigns(id BIGINT,user_id BIGINT,title TEXT,campaign_data JSONB);');await db.query('INSERT INTO vira_campaigns VALUES(1,1,$1,$2)',['Campagne',JSON.stringify(data)]);let subscriptionChecks=0;
 installProductionPlan({app:{get:(url,...h)=>handlers['GET '+url]=h.at(-1),post:(url,...h)=>handlers['POST '+url]=h.at(-1)},pool:{query:(q,a)=>{queries.push(q);return db.query(q,a);}},requireAuth(){},requireCreation:(_req,_res,next)=>{subscriptionChecks++;return next();},factsFor:async()=>facts,inspectMedia:async()=>({visuals:true,voice:true,video:false})});
 const call=async(method,owner,body={kind:'video'})=>{const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(d){this.body=d;return this;}};await handlers[method+' /api/campaigns/:id/'+(method==='GET'?'production-plan':'production-quote')]({params:{id:'1'},user:{id:owner},body},res);return res;};
 try{assert.equal((await call('GET',2)).code,404);assert.equal((await call('POST',2)).code,404);assert.equal(subscriptionChecks,0);assert.equal((await call('POST',1)).body.credits.videos,1);assert.equal(subscriptionChecks,1);assert.equal((await call('POST',1,{kind:'invalid'})).code,400);assert.ok(queries.every(q=>q.startsWith('SELECT')));}finally{await db.close();}
});
test('image reuse quote checks server-owned job fingerprint and owner',async()=>{
 const prompts=['One','Two','Three','Four'],jobId='12345678-1234-1234-1234-123456789abc',fingerprint=crypto.createHash('sha256').update(JSON.stringify(prompts)).digest('hex'),handlers={};
 const queries=[];installProductionPlan({app:{get(){},post:(url,...h)=>handlers.quote=h.at(-1)},pool:{query:async(q,args)=>{queries.push({q,args});return q.includes('vira_campaigns')?{rows:[{id:1,title:'Campagne',campaign_data:data}]}:{rows:args[1]===1?[{fingerprint}]:[]};}},requireAuth(){},requireCreation:(_req,_res,next)=>next(),factsFor:async()=>({...facts,credits:{images:{remaining:0},videos:{remaining:1}}}),inspectMedia:async()=>({visuals:true,voice:true,video:false})});
 const call=async(owner,imagePrompts)=>{const res={status(n){this.code=n;return this;},setHeader(){},json(value){this.body=value;return this;}};await handlers.quote({params:{id:'1'},user:{id:owner},body:{kind:'images',imageRequest:{requestId:jobId,prompts:imagePrompts}}},res);return res;};
 assert.equal((await call(1,prompts)).body.credits.images,0);assert.equal((await call(1,['Changed',...prompts.slice(1)])).code,409);assert.equal((await call(2,prompts)).body.available,false);assert.ok(queries.filter(x=>x.q.includes('vira_image_jobs')).every(x=>x.q.includes('user_id=$2')));
});
