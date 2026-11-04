import './script-model.js';
import crypto from 'node:crypto';
import {validateImageRequest} from './image-generation.mjs';
const scriptModel=globalThis.olyvexScriptModel;
export function buildProductionPlan({campaign,facts,media}){
 const data=campaign.campaign_data||{};let scriptReady=false;
 try{const script=scriptModel.normalize(scriptModel.parse(data.scenario||''));scriptReady=Boolean(script.objective&&script.target&&script.narration);}catch{}
 const visualsReady=scriptReady&&Boolean(media.visuals),voiceReady=visualsReady&&Boolean(media.voice),exportReady=Boolean(media.video);
 const steps=[{id:'script',ready:scriptReady},{id:'visuals',ready:visualsReady},{id:'voice',ready:voiceReady},{id:'export',ready:exportReady}];
 return {ok:true,campaignId:String(campaign.id),title:String(campaign.title||'').slice(0,160),checkedAt:new Date().toISOString(),steps,next:exportReady?'download':steps.find(s=>!s.ready)?.id||'download',brandName:String(data.brand?.name||'').slice(0,100),credits:facts.credits||null,features:facts.features||{},audioId:voiceReady?data.narration.audioId:null,videoUrl:exportReady?data.videoUrl:null};
}
export function quoteProduction(plan,kind,{existingImageJob=false}={}){
 const ready=id=>plan.steps.find(s=>s.id===id)?.ready;
 const credits={images:kind==='images'&&!existingImageJob?4:0,videos:kind==='video'?1:0};
 let available=true,reason='';
 if(!['images','voice','captions','video'].includes(kind))throw Error('Action de production invalide.');
 if(!ready('script')){available=false;reason='Complétez et sauvegardez le scénario de quatre scènes.';}
 else if(kind==='images'&&!existingImageJob&&!plan.features.aiImages){available=false;reason='La génération IA n’est pas activée pour ce compte. Importez vos quatre visuels.';}
 else if(['voice','captions','video'].includes(kind)&&!ready('visuals')){available=false;reason='Ajoutez et sauvegardez vos quatre visuels.';}
 else if(kind==='voice'&&!plan.features.automaticVoice){available=false;reason='La voix automatique est indisponible. Importez une narration.';}
 else if(['captions','video'].includes(kind)&&!ready('voice')){available=false;reason='Préparez et sauvegardez votre narration.';}
 else if(kind==='captions'&&!plan.features.automaticCaptions){available=false;reason='La synchronisation automatique est indisponible. Saisissez les sous-titres manuellement.';}
 for(const resource of ['images','videos'])if(available&&credits[resource]){const remaining=plan.credits?.[resource]?.remaining;if(!Number.isFinite(remaining)){available=false;reason='Impossible de vérifier les crédits. Réessayez avant de générer.';}else if(remaining<credits[resource]){available=false;reason='Crédits insuffisants. Consultez vos forfaits et blocs.';}}
 return {ok:true,kind,campaignId:plan.campaignId,title:plan.title,checkedAt:plan.checkedAt,audioId:plan.audioId,credits,remaining:plan.credits,available,reason,existingImageJob,dailyVoiceLimit:kind==='voice'||kind==='captions',mayReuseCache:kind==='captions'};
}
export function installProductionPlan({app,pool,requireAuth,requireCreation,factsFor,inspectMedia}){
 const load=async req=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(Error('Campagne invalide.'),{status:400});const {rows}=await pool.query('SELECT id,title,campaign_data FROM vira_campaigns WHERE id=$1 AND user_id=$2',[id,req.user.id]);if(!rows[0])throw Object.assign(Error('Campagne introuvable.'),{status:404});return buildProductionPlan({campaign:rows[0],facts:await factsFor(req.user),media:await inspectMedia(rows[0].campaign_data||{},req.user.id)});};
 const route=fn=>async(req,res)=>{res.setHeader('Cache-Control','private, no-store');try{return await fn(req,res);}catch(error){return res.status(error.status||503).json({ok:false,error:error.status?error.message:'La vérification de la campagne est indisponible. Aucun média n’a été généré.'});}};
 app.get('/api/campaigns/:id/production-plan',requireAuth,route(async(req,res)=>res.json(await load(req))));
 app.post('/api/campaigns/:id/production-quote',requireAuth,route(async(req,res)=>{
  if(!['images','voice','captions','video'].includes(req.body?.kind))return res.status(400).json({ok:false,error:'Action de production invalide.'});
  // Resolve ownership before checking the subscription. No generation or credit
  // reservation occurs in either the plan or quote endpoint.
  const plan=await load(req);let existingImageJob=false;
  if(req.body.kind==='images'&&req.body.imageRequest){let request;try{request=validateImageRequest(req.body.imageRequest);}catch{return res.status(400).json({ok:false,error:'Demande d’images invalide.'});}const fingerprint=crypto.createHash('sha256').update(JSON.stringify(request.prompts)).digest('hex');const {rows}=await pool.query('SELECT fingerprint FROM vira_image_jobs WHERE id=$1 AND user_id=$2',[request.id,req.user.id]);if(rows[0]){if(rows[0].fingerprint!==fingerprint)return res.status(409).json({ok:false,error:'Les scènes ont changé. Préparez une nouvelle demande d’images.'});existingImageJob=true;}}
  return requireCreation(req,res,()=>res.json(quoteProduction(plan,req.body.kind,{existingImageJob})));
 }));
}
