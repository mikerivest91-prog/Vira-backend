import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import './export-model.js';
import {wordCues,transcribeCaptions,cachedCaptions} from './caption-service.mjs';
import {installExportRoutes} from './export-routes.mjs';
import {PGlite} from '@electric-sql/pglite';
const model=globalThis.olyvexExportModel,id='12345678-1234-1234-1234-123456789abc';
test('formats are bounded and unsafe caption payloads are rejected',()=>{
 assert.deepEqual(Object.values(model.formats).map(x=>[x.width,x.height]),[[720,1280],[720,720],[1280,720]]);
 assert.throws(()=>model.normalize({format:'x'}));assert.throws(()=>model.normalize({captionsEnabled:true,audioId:id}));
 for(const cues of [[{start:2,end:1,text:'X'}],[{start:0,end:3,text:'A'},{start:2,end:4,text:'B'}],[{start:0,end:61,text:'A'}]])assert.throws(()=>model.normalize({audioId:id,cues}));
});
test('SRT and VTT preserve accents and actual timing without markup',()=>{
 const cues=[{start:.125,end:2.5,text:'Découvrez <notre> offre !'}];assert.match(model.subtitles(cues),/00:00:00,125 --> 00:00:02,500/);assert.match(model.subtitles(cues,true),/^WEBVTT/);assert.ok(!model.subtitles(cues).includes('<'));
});
test('word grouping retains silence instead of inventing even timing',()=>{
 const cues=wordCues([{start:.4,end:.7,word:'Bonjour'},{start:.8,end:1.1,word:'Québec.'},{start:3,end:3.5,word:'Découvrez'},{start:3.6,end:4,word:'OLYVEX.'}],5);
 assert.equal(cues.length,2);assert.equal(cues[0].start,.4);assert.equal(cues[1].start,3);assert.equal(cues[1].end,4);
 assert.throws(()=>wordCues([],5));assert.throws(()=>wordCues([{word:'A',start:4,end:3}],5));
});
test('provider uses timed words, caps failure and never retries automatically',async()=>{
 let calls=0;const cues=await transcribeCaptions(Buffer.from('fixture'),5,{key:'test',fetchImpl:async(url,options)=>{calls++;assert.equal(options.body.get('model'),'whisper-1');assert.equal(options.body.get('timestamp_granularities[]'),'word');assert.equal(options.body.get('response_format'),'verbose_json');return new Response(JSON.stringify({words:[{start:.5,end:1,word:'Salut'}]}),{headers:{'Content-Type':'application/json'}});}});
 assert.equal(calls,1);assert.equal(cues[0].start,.5);
 await assert.rejects(transcribeCaptions(Buffer.from('x'),5,{key:'test',fetchImpl:async()=>{calls++;return new Response('secret provider text',{status:429});}}),/indisponible/);assert.equal(calls,2);
});
test('same audio cache avoids a second provider call and reservation',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'olyvex-caption-test-')),file=path.join(directory,'audio.wav');let requests=0,reserves=0;
 try{await writeFile(file,'fixture');const options={reserve:async()=>{reserves++;return true;},transcribe:async()=>{requests++;return [{start:.1,end:1,text:'Bonjour.'}];}};
 assert.equal((await cachedCaptions(file,5,options)).cached,false);assert.equal((await cachedCaptions(file,5,options)).cached,true);assert.equal(requests,1);assert.equal(reserves,1);
 await writeFile(file,'different audio');await cachedCaptions(file,5,options);assert.equal(requests,2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('export settings are owner-scoped and preserve other campaign fields in real PostgreSQL',async()=>{
 const db=new PGlite(),handlers={};await db.exec("CREATE TABLE vira_campaigns(id BIGINT PRIMARY KEY,user_id BIGINT,campaign_data JSONB,updated_at TIMESTAMPTZ);");await db.query('INSERT INTO vira_campaigns VALUES(1,1,$1,NOW())',[JSON.stringify({scenario:'Keep',brand:{name:'Marque'}})]);
 installExportRoutes({app:{get:(url,...h)=>handlers['GET '+url]=h.at(-1),post(){},patch:(url,...h)=>handlers['PATCH '+url]=h.at(-1)},pool:{query:(q,a)=>db.query(q,a)},requireAuth(){},resourceProtection:{run:x=>x},audioDirectory:'unused',env:{}});
 const call=async(method,owner,settings)=>{const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await handlers[method+' /api/campaigns/:id/export-settings']({params:{id:'1'},user:{id:owner},body:{settings}},res);return res;};
 try{assert.equal((await call('PATCH',2,{format:'square'})).code,404);assert.equal((await call('PATCH',1,{format:'square'})).code,200);assert.equal((await call('GET',2)).code,404);assert.equal((await call('GET',1)).body.settings.format,'square');const d=(await db.query('SELECT campaign_data FROM vira_campaigns')).rows[0].campaign_data;assert.equal(d.scenario,'Keep');assert.equal(d.brand.name,'Marque');}finally{await db.close();}
});
