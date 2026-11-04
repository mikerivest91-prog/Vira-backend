import { audioFile, wavDuration } from './audio-service.mjs';

const voices=new Set(['female','male','female_fr','male_fr','female_en_ca','male_en_ca','female_en_us_ava','male_en_us_andrew','female_en_gb_sonia','male_en_gb_ryan']);
export function installCampaignNarration({app,pool,requireAuth,audioDirectory,durationOf=wavDuration}) {
  const fail=(res,status,error)=>res.status(status).json({ok:false,error});
  const route=handler=>async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,'Campagne invalide.');
    try{
      const {rows}=await pool.query('SELECT campaign_data FROM vira_campaigns WHERE id=$1 AND user_id=$2',[id,req.user.id]);
      if(!rows[0])return fail(res,404,'Campagne introuvable.');
      await handler(req,res,id,rows[0].campaign_data||{});
    }catch{return fail(res,503,'Impossible de retrouver ou sauvegarder la narration. Réessayez.');}
  };
  app.get('/api/campaigns/:id/narration',requireAuth,route(async(req,res,_id,data)=>{
    const narration=data.narration;
    if(!narration?.audioId)return res.json({ok:true,narration:null});
    try{
      const duration=await durationOf(audioFile(audioDirectory,req.user.id,narration.audioId));
      return res.json({ok:true,scenario:data.scenario||'',narration:{...narration,duration,audioUrl:`/api/audio/${narration.audioId}`}});
    }catch{return fail(res,404,'La narration enregistrée est indisponible. Importez-la ou préparez-la de nouveau.');}
  }));
  app.patch('/api/campaigns/:id/narration',requireAuth,route(async(req,res,id)=>{
    const body=req.body;
    if(typeof body?.scenario!=='string')return fail(res,400,'Scénario invalide.');
    let narration=null;
    if(body.audioId!==null){
      if(!['auto','personal'].includes(body.mode)||typeof body.text!=='string'||body.text.length>800||!voices.has(body.voice))return fail(res,400,'Narration invalide.');
      let duration;
      try{duration=await durationOf(audioFile(audioDirectory,req.user.id,body.audioId));}
      catch{return fail(res,400,'Audio indisponible pour ce compte.');}
      narration={audioId:body.audioId,mode:body.mode,text:body.text,voice:body.voice,duration};
    }
    const {rows}=await pool.query(`UPDATE vira_campaigns SET campaign_data=COALESCE(campaign_data,'{}'::jsonb)||jsonb_build_object('narration',$3::jsonb),updated_at=NOW()
      WHERE id=$1 AND user_id=$2 AND COALESCE(campaign_data->>'scenario','')=$4 RETURNING id`,[id,req.user.id,JSON.stringify(narration),body.scenario]);
    if(!rows[0])return fail(res,409,'La campagne a changé. Rouvrez-la avant de sauvegarder la narration.');
    return res.json({ok:true,narration});
  }));
}
