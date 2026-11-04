import crypto from 'node:crypto';
import './script-model.js';
import {assistantLinks} from './assistant-knowledge.mjs';
import {normalizeAssistantInput,normalizeAssistantDraft,requestAssistant} from './assistant-provider.mjs';
const scriptModel=globalThis.olyvexScriptModel;
const bounded=(value,fallback,max)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=1&&n<=max?n:fallback;};
export const assistantDatabase=`CREATE TABLE IF NOT EXISTS olyvex_assistant_daily(day DATE NOT NULL,user_id BIGINT NOT NULL,requests INTEGER NOT NULL DEFAULT 0,last_request TIMESTAMPTZ,pending_until TIMESTAMPTZ,lease UUID,PRIMARY KEY(day,user_id));
CREATE TABLE IF NOT EXISTS olyvex_assistant_drafts(id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,proposal JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,campaign_id BIGINT REFERENCES vira_campaigns(id) ON DELETE SET NULL,applied_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS olyvex_assistant_draft_expiry ON olyvex_assistant_drafts(expires_at);`;
export function createAssistantBudget({pool,userLimit=20,globalLimit=200}){
 return {async reserve(userId){const db=await pool.connect(),lease=crypto.randomUUID();try{
  await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(91351,0)');
  const {rows}=await db.query("SELECT *,pending_until>NOW() AS pending,EXTRACT(EPOCH FROM (NOW()-last_request)) AS age FROM olyvex_assistant_daily WHERE day=(NOW() AT TIME ZONE 'UTC')::date AND user_id=ANY($1::bigint[])",[[0,userId]]);
  const user=rows.find(r=>String(r.user_id)===String(userId)),global=rows.find(r=>String(r.user_id)==='0');
  if(user?.pending||(user?.age!=null&&Number(user.age)<4)){await db.query('ROLLBACK');return {ok:false,error:'Une réponse vient d’être demandée. Patientez quelques secondes.'};}
  if(Number(user?.requests||0)>=userLimit||Number(global?.requests||0)>=globalLimit){await db.query('ROLLBACK');return {ok:false,error:'La limite quotidienne de l’assistante est atteinte. Réessayez demain ou contactez le support.'};}
  await db.query("INSERT INTO olyvex_assistant_daily(day,user_id,requests,last_request,pending_until,lease) VALUES((NOW() AT TIME ZONE 'UTC')::date,$1,1,NOW(),NOW()+INTERVAL '75 seconds',$2) ON CONFLICT(day,user_id) DO UPDATE SET requests=olyvex_assistant_daily.requests+1,last_request=NOW(),pending_until=NOW()+INTERVAL '75 seconds',lease=$2",[userId,lease]);
  await db.query("INSERT INTO olyvex_assistant_daily(day,user_id,requests) VALUES((NOW() AT TIME ZONE 'UTC')::date,0,1) ON CONFLICT(day,user_id) DO UPDATE SET requests=olyvex_assistant_daily.requests+1");
  await db.query('COMMIT');return {ok:true,lease,remaining:userLimit-Number(user?.requests||0)-1};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}},
 async release(userId,lease){await pool.query('UPDATE olyvex_assistant_daily SET pending_until=NULL,lease=NULL WHERE user_id=$1 AND lease=$2',[userId,lease]);}};
}
export function installAssistant({app,pool,requireAuth,brandProfile,factsFor,env=process.env,provider=requestAssistant}){
 const userLimit=bounded(env.ASSISTANT_DAILY_LIMIT,20,500),globalLimit=bounded(env.ASSISTANT_GLOBAL_DAILY_LIMIT,200,5000);
 const budget=createAssistantBudget({pool,userLimit,globalLimit});
 const enabled=()=>env.ASSISTANT_ENABLED!=='false'&&Boolean(env.OPENAI_API_KEY);
 const origin=(env.APP_ORIGIN||'https://vira-backend-im5s.onrender.com').replace(/\/$/,'');
 const noStore=(req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==origin)return res.status(403).json({ok:false,error:'Origine invalide.'});return next();};
 app.get('/api/assistant/config',requireAuth,noStore,async(req,res)=>{
  try{const {rows}=await pool.query("SELECT requests FROM olyvex_assistant_daily WHERE day=(NOW() AT TIME ZONE 'UTC')::date AND user_id=$1",[req.user.id]);return res.json({ok:true,enabled:enabled(),dailyLimit:userLimit,remaining:Math.max(0,userLimit-Number(rows[0]?.requests||0)),supportEmail:'olyvex@olyvexapp.com'});}catch{return res.status(503).json({ok:false,error:'Aide indisponible. Réessayez plus tard.'});}
 });
 app.post('/api/assistant/message',requireAuth,noStore,async(req,res)=>{
  if(!enabled())return res.status(503).json({ok:false,error:'L’assistante IA est temporairement indisponible.'});
  let input;try{input=normalizeAssistantInput(req.body);}catch(error){return res.status(400).json({ok:false,error:error.message});}
  let reservation;
  try{
   const facts=await factsFor(req.user);facts.campaign=null;
   if(input.campaignId){const {rows}=await pool.query('SELECT title,status,campaign_data FROM vira_campaigns WHERE id=$1 AND user_id=$2',[input.campaignId,req.user.id]);if(!rows[0])return res.status(404).json({ok:false,error:'Campagne introuvable pour ce compte.'});const c=rows[0],data=c.campaign_data||{},parsed=scriptModel.parse(data.scenario||'');facts.campaign={title:String(c.title).slice(0,160),status:c.status,brief:String(data.brief||'').slice(0,1200),objective:parsed.objective.slice(0,700),target:parsed.target.slice(0,700),hook:parsed.hook.slice(0,500),narration:parsed.narration.slice(0,800),scenes:parsed.scenes.map(s=>s.slice(0,400)),visualsReady:data.generatedImages?.length===4||data.sourceClips?.length===4,voiceSaved:Boolean(data.narration?.audioId),exportSaved:Boolean(data.videoUrl)};}
   reservation=await budget.reserve(req.user.id);if(!reservation.ok){res.setHeader('Retry-After','5');return res.status(429).json({ok:false,error:reservation.error});}
   const result=await provider(input,facts,{key:env.OPENAI_API_KEY,modelName:env.ASSISTANT_MODEL||'gpt-5.4-mini-2026-03-17'});
   let draft=null;
   if(result.draft){const proposal=normalizeAssistantDraft(result.draft),id=crypto.randomUUID();await pool.query("INSERT INTO olyvex_assistant_drafts(id,user_id,proposal,expires_at) VALUES($1,$2,$3::jsonb,NOW()+INTERVAL '2 hours')",[id,req.user.id,JSON.stringify(proposal)]);draft={id,...proposal};}
   void pool.query('DELETE FROM olyvex_assistant_drafts WHERE expires_at<NOW()').catch(()=>{});
   return res.json({ok:true,reply:result.reply,links:result.links.filter(id=>Object.hasOwn(assistantLinks,id)).map(id=>({id,...assistantLinks[id]})),draft,remaining:reservation.remaining});
  }catch{return res.status(503).json({ok:false,error:'L’assistante n’a pas pu répondre. Votre message reste disponible ; aucun crédit vidéo ou image n’a été utilisé.'});}
  finally{if(reservation?.ok)await budget.release(req.user.id,reservation.lease).catch(()=>{});}
 });
 app.post('/api/assistant/drafts/:id/apply',requireAuth,noStore,async(req,res)=>{
  if(!/^[0-9a-f-]{36}$/i.test(req.params.id))return res.status(400).json({ok:false,error:'Proposition invalide.'});
  const db=await pool.connect().catch(()=>null);if(!db)return res.status(503).json({ok:false,error:'Sauvegarde indisponible.'});
  try{await db.query('BEGIN');const {rows}=await db.query('SELECT *,expires_at<=NOW() AS expired FROM olyvex_assistant_drafts WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id]);const draft=rows[0];
   if(!draft){await db.query('ROLLBACK');return res.status(404).json({ok:false,error:'Proposition introuvable.'});}
   if(draft.applied_at){const saved=(await db.query('SELECT id,title,status FROM vira_campaigns WHERE id=$1 AND user_id=$2',[draft.campaign_id,req.user.id])).rows[0];await db.query('COMMIT');return saved?res.json({ok:true,campaign:saved,reused:true}):res.status(410).json({ok:false,error:'Le brouillon créé a été supprimé. Demandez une nouvelle proposition.'});}
   if(draft.expired){await db.query('ROLLBACK');return res.status(410).json({ok:false,error:'Cette proposition a expiré. Demandez-en une nouvelle.'});}
   const proposal=normalizeAssistantDraft(draft.proposal),script=proposal.script;
   const data={brief:proposal.brief,scenario:scriptModel.serialize(script),audience:script.target,goal:script.objective,tone:proposal.tone,platform:proposal.platform,marketingType:'📢 Créer une publicité',generatedImages:[],sourceClips:[],brand:await brandProfile.read(req.user.id),publicationDraft:{caption:script.publication,hashtags:script.hashtags},assistantDraftId:draft.id};
   const saved=(await db.query("INSERT INTO vira_campaigns(user_id,title,status,campaign_data) VALUES($1,$2,'draft',$3::jsonb) RETURNING id,title,status",[req.user.id,script.title,JSON.stringify(data)])).rows[0];
   await db.query('UPDATE olyvex_assistant_drafts SET campaign_id=$2,applied_at=NOW() WHERE id=$1',[draft.id,saved.id]);await db.query('COMMIT');return res.status(201).json({ok:true,campaign:saved,reused:false});
  }catch{await db.query('ROLLBACK').catch(()=>{});return res.status(503).json({ok:false,error:'Le brouillon n’a pas été enregistré. Réessayez : une même proposition ne crée pas de doublon.'});}finally{db.release();}
 });
 return {async init(){for(const sql of assistantDatabase.split(';').filter(s=>s.trim()))await pool.query(sql);await pool.query("DELETE FROM olyvex_assistant_daily WHERE day<(NOW() AT TIME ZONE 'UTC')::date-31");await pool.query('DELETE FROM olyvex_assistant_drafts WHERE expires_at<NOW()');}};
}
