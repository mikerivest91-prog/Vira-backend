import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {normalizeAssistantInput,normalizeAssistantDraft,requestAssistant} from './assistant-provider.mjs';
import {createAssistantBudget,assistantDatabase,installAssistant} from './assistant-service.mjs';
import {assistantFacts} from './assistant-facts.mjs';
const script={title:'Savons artisanaux',objective:'Obtenir des visites en boutique',target:'Adultes de Québec',hook:'Un moment de douceur.',publication:'Découvrez nos savons en boutique.',hashtags:'#Artisanat',narration:'Découvrez nos savons artisanaux. Visitez notre boutique.',cta:'Visitez notre boutique',visualPrompt:'Photographie de produit réaliste',style:'Amical',scenes:['Présenter le savon','Montrer sa texture','Présenter la boutique','Inviter à visiter']};
const proposal={brief:'Savons artisanaux pour des adultes de Québec, objectif visites en boutique.',platform:'Instagram',tone:'Amical',script};
test('only bounded user messages and user/assistant history are accepted',()=>{
 assert.equal(normalizeAssistantInput({message:' Bonjour ',language:'en'}).message,'Bonjour');
 for(const body of [{message:''},{message:'a'.repeat(1601)},{message:'x',history:[{role:'system',content:'Inject'}]},{message:'x',campaignId:'../../1'},{message:'x',history:Array(9).fill({role:'user',content:'x'})}])assert.throws(()=>normalizeAssistantInput(body));
 assert.throws(()=>normalizeAssistantDraft({...proposal,script:{...script,scenes:['x']}}));
});
test('provider response is structured, bounded, stateless and has no tools or automatic retry',async()=>{
 let count=0;const fetchImpl=async(url,options)=>{count++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.model,'gpt-5.4-mini-2026-03-17');assert.equal(body.reasoning.effort,'none');assert.equal(body.tools,undefined);assert.equal(body.text.format.strict,true);assert.ok(body.instructions.includes('ne modifies'));return new Response(JSON.stringify({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Voici votre proposition.',links:['campaigns'],draft:proposal})}]}]}));};
 const r=await requestAssistant(normalizeAssistantInput({message:'Prépare ma campagne.'}),{credits:null},{key:'test',fetchImpl});assert.equal(r.draft.script.scenes.length,4);assert.equal(count,1);
 await assert.rejects(requestAssistant({message:'x'}, {},{key:'test',fetchImpl:async()=>{count++;return new Response('secret error',{status:429});}}),/indisponible/);assert.equal(count,2);
 await assert.rejects(requestAssistant({message:'x'}, {},{key:'test',fetchImpl:async()=>new Response(JSON.stringify({status:'incomplete',output:[]}))}),/incomplète/);
});
let db,pool,handlers,calls,failProvider=false,lastFacts;
test.before(async()=>{db=new PGlite();await db.exec('CREATE TABLE vira_users(id BIGINT PRIMARY KEY);INSERT INTO vira_users VALUES(1),(2);CREATE TABLE vira_campaigns(id BIGSERIAL PRIMARY KEY,user_id BIGINT,title TEXT,status TEXT,campaign_data JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());');await db.exec(assistantDatabase);pool={query:(q,a)=>db.query(q,a),connect:async()=>({query:(q,a)=>db.query(q,a),release(){}})};});
test.beforeEach(async()=>{await db.exec('TRUNCATE olyvex_assistant_drafts,olyvex_assistant_daily,vira_campaigns RESTART IDENTITY CASCADE');calls=0;failProvider=false;handlers={};const app={get:(url,...h)=>handlers['GET '+url]=h,post:(url,...h)=>handlers['POST '+url]=h};installAssistant({app,pool,requireAuth:(req,res,next)=>next(),brandProfile:{read:async()=>({name:'Ma marque',tagline:'Notre signature',primaryColor:'#123456',email:'private@example.invalid',phone:'secret contact',logo:'private logo'})},factsFor:async()=>({credits:{videos:{remaining:4}}}),env:{OPENAI_API_KEY:'test'},provider:async(input,facts)=>{calls++;lastFacts=facts;if(failProvider)throw Error('secret failure');return {reply:'Votre proposition.',links:['campaigns'],draft:proposal};}});});
test.after(()=>db.close());
async function call(url,body={},owner=1,params={}){const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};const req={body,user:{id:owner},params,headers:{},method:url.split(' ')[0]};const list=handlers[url];let i=0;const next=()=>list[i++]?.(req,res,next);await next();return res;}
test('persistent per-user and global budgets reject excess work before provider calls',async()=>{
 const budget=createAssistantBudget({pool,userLimit:1,globalLimit:2});const first=await budget.reserve(1);assert.equal(first.ok,true);assert.equal((await budget.reserve(1)).ok,false);await budget.release(1,first.lease);await db.query("UPDATE olyvex_assistant_daily SET last_request=NOW()-INTERVAL '10 seconds' WHERE user_id=1");assert.equal((await budget.reserve(1)).ok,false);const second=await budget.reserve(2);assert.equal(second.ok,true);await budget.release(2,second.lease);const other=createAssistantBudget({pool,userLimit:20,globalLimit:2});await db.exec("UPDATE olyvex_assistant_daily SET last_request=NOW()-INTERVAL '10 seconds'");assert.equal((await other.reserve(2)).ok,false);
});
test('foreign campaign is refused before provider call or budget reservation',async()=>{
 await db.query("INSERT INTO vira_campaigns(user_id,title,status,campaign_data) VALUES(2,'Other','draft','{}')");const r=await call('POST /api/assistant/message',{message:'Aide-moi',campaignId:1});assert.equal(r.code,404);assert.equal(calls,0);assert.equal((await db.query('SELECT * FROM olyvex_assistant_daily')).rows.length,0);
});
test('campaign context is opt-in, owner-scoped and excludes media and credentials',async()=>{
 await db.query("INSERT INTO vira_campaigns(user_id,title,status,campaign_data) VALUES(1,'Campagne','draft',$1)",[JSON.stringify({brief:'Mon offre',scenario:globalThis.olyvexScriptModel.serialize(script),generatedImages:['secret image'],brand:{email:'private@example.invalid'},videoUrl:'/videos/private.mp4'})]);
 const r=await call('POST /api/assistant/message',{message:'Aide-moi',campaignId:1});assert.equal(r.code,200);assert.equal(lastFacts.campaign.brief,'Mon offre');assert.ok(!JSON.stringify(lastFacts).includes('secret image'));assert.ok(!JSON.stringify(lastFacts).includes('private@example.invalid'));assert.ok(r.body.draft.id);
});
test('no campaign is sent without explicit selection; preview creates no campaign or media usage',async()=>{
 const r=await call('POST /api/assistant/message',{message:'Prépare une campagne.'});assert.equal(r.code,200);assert.equal(lastFacts.campaign,null);assert.equal((await db.query('SELECT * FROM vira_campaigns')).rows.length,0);assert.equal(r.body.remaining,19);assert.equal(r.body.links[0].action,'navCampaigns');
});
test('draft acceptance creates a new campaign exactly once without provider calls',async()=>{
 const r=await call('POST /api/assistant/message',{message:'Prépare une campagne.'});const id=r.body.draft.id;assert.equal((await call('POST /api/assistant/drafts/:id/apply',{},2,{id})).code,404);
 const first=await call('POST /api/assistant/drafts/:id/apply',{},1,{id});assert.equal(first.code,201);const repeated=await call('POST /api/assistant/drafts/:id/apply',{},1,{id});assert.equal(repeated.code,200);assert.equal(repeated.body.reused,true);assert.equal(first.body.campaign.id,repeated.body.campaign.id);assert.equal(calls,1);
 const saved=(await db.query('SELECT * FROM vira_campaigns')).rows;assert.equal(saved.length,1);assert.equal(saved[0].user_id,1);assert.equal(saved[0].campaign_data.brand.name,'Ma marque');assert.equal(saved[0].campaign_data.generatedImages.length,0);assert.equal(saved[0].campaign_data.narration,undefined);
});
test('expired proposal cannot create a campaign and provider failure keeps only bounded counters',async()=>{
 const result=await call('POST /api/assistant/message',{message:'Prépare une campagne.'});const id=result.body.draft.id;await db.query("UPDATE olyvex_assistant_drafts SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[id]);assert.equal((await call('POST /api/assistant/drafts/:id/apply',{},1,{id})).code,410);assert.equal((await db.query('SELECT * FROM vira_campaigns')).rows.length,0);
 failProvider=true;const r=await call('POST /api/assistant/message',{message:'Bonjour'},2);assert.equal(r.code,503);assert.ok(!JSON.stringify(r.body).includes('secret'));const state=(await db.query('SELECT * FROM olyvex_assistant_daily WHERE user_id=2')).rows[0];assert.equal(state.requests,1);assert.equal(state.lease,null);assert.equal(state.pending_until,null);
});
test('cross-origin requests are refused without provider calls',async()=>{
 const res={status(n){this.code=n;return this;},setHeader(){},json(body){this.body=body;return this;}};let ran=false;await handlers['POST /api/assistant/message'][1]({method:'POST',headers:{origin:'https://foreign.invalid'}},res,()=>ran=true);assert.equal(res.code,403);assert.equal(ran,false);assert.equal(calls,0);
});
test('support facts use server identity, explicit currency units and no customer credentials',async()=>{
 const user={id:1,email:'private@example.invalid'};
 const facts=await assistantFacts({pool:{query:async(_sql,args)=>{assert.equal(args[0],1);return {rows:[{videos:2,images:3}]};}},user,commerce:{applies:()=>false,animationEnabled:false},videoQuotaFor:()=>({limit:4}),env:{}});
 assert.equal(facts.credits.videos.remaining,2);assert.equal(facts.credits.images.remaining,13);assert.equal(facts.catalog[0].price,29.99);assert.equal(facts.features.aiImages,false);assert.equal(facts.features.animations,false);assert.ok(!JSON.stringify(facts).includes(user.email));
 const missing=await assistantFacts({pool:{query:async()=>{throw Error('secret');}},user,commerce:{applies:()=>false},videoQuotaFor:()=>({limit:4}),env:{}});assert.equal(missing.credits,null);
});
test('brand is optional and only name, tagline and valid colors reach the model',async()=>{
 await call('POST /api/assistant/message',{message:'Prépare ma campagne.',useBrand:true,brand:{email:'forged'}});assert.deepEqual(lastFacts.brand,{name:'Ma marque',tagline:'Notre signature',primaryColor:'#123456',secondaryColor:null});assert.ok(!JSON.stringify(lastFacts).includes('private@example.invalid'));assert.ok(!JSON.stringify(lastFacts).includes('private logo'));
 const other=await call('POST /api/assistant/message',{message:'Prépare ma campagne.',useBrand:false},2);assert.equal(other.code,200);assert.equal(lastFacts.brand,null);
});
