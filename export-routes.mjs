import './export-model.js';
import {audioFile,wavDuration} from './audio-service.mjs';
import {cachedCaptions} from './caption-service.mjs';
const model=globalThis.olyvexExportModel;
export function installExportRoutes({app,pool,requireAuth,resourceProtection,audioDirectory,env=process.env,captionCache=cachedCaptions}){
  app.get('/api/video/export-config',requireAuth,(_req,res)=>res.json({ok:true,formats:model.formats,automaticCaptions:Boolean(env.OPENAI_API_KEY),maxDuration:60}));
  app.post('/api/audio/captions',requireAuth,resourceProtection.run(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    let filename,duration;
    try{filename=audioFile(audioDirectory,req.user.id,req.body?.audioId);duration=await wavDuration(filename);}catch{return res.status(404).json({ok:false,error:'La voix est indisponible. Préparez-la de nouveau.'});}
    try{const result=await captionCache(filename,duration,{reserve:()=>resourceProtection.reserveVoice(req.user.id),accept:res.locals.acceptMedia});return res.json({ok:true,audioId:req.body.audioId,duration,...result});}
    catch(error){return res.status(error.status||503).json({ok:false,error:error.message});}
  }));
  app.get('/api/campaigns/:id/export-settings',requireAuth,async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    try{const {rows}=await pool.query('SELECT campaign_data FROM vira_campaigns WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!rows[0])return res.status(404).json({ok:false,error:'Campagne introuvable.'});return res.json({ok:true,settings:rows[0].campaign_data?.exportSettings||model.normalize()});}catch{return res.status(503).json({ok:false,error:'Options indisponibles.'});}
  });
  app.patch('/api/campaigns/:id/export-settings',requireAuth,async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    let settings;
    try{const value=req.body?.settings;let duration=60;if(value?.cues?.length||value?.captionsEnabled)duration=await wavDuration(audioFile(audioDirectory,req.user.id,value.audioId));settings=model.normalize(value,duration);}catch(error){return res.status(400).json({ok:false,error:error.code==='ENOENT'?'Préparez de nouveau la voix.':error.message});}
    try{const {rows}=await pool.query("UPDATE vira_campaigns SET campaign_data=jsonb_set(COALESCE(campaign_data,'{}'::jsonb),'{exportSettings}',$3::jsonb),updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id",[req.params.id,req.user.id,JSON.stringify(settings)]);if(!rows[0])return res.status(404).json({ok:false,error:'Campagne introuvable.'});return res.json({ok:true,settings});}catch{return res.status(503).json({ok:false,error:'Options non enregistrées. Réessayez avant de quitter.'});}
  });
}
export async function validatedExport(value,audioId,audioDirectory,userId){
  const settings=model.normalize(value??{});
  if(settings.captionsEnabled){if(settings.audioId!==audioId)throw Error('Les sous-titres correspondent à une autre voix. Recréez-les.');model.normalize(settings,await wavDuration(audioFile(audioDirectory,userId,audioId)));}
  if(settings.sceneDurations && audioId){const voiceDuration=await wavDuration(audioFile(audioDirectory,userId,audioId));if(settings.sceneDurations.reduce((a,b)=>a+b,0)+0.05<voiceDuration)throw Error('Allongez les scènes pour couvrir toute la narration.');}
  return settings;
}
