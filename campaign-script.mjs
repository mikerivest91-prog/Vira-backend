import './script-model.js';
const model = globalThis.olyvexScriptModel;

export function installCampaignScript({app, pool, requireAuth, decodeImage}) {
  app.patch('/api/campaigns/:id/script', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ok:false,error:'Campagne invalide.'});
    let script, order, scenario, replacements;
    try {
      if (typeof req.body?.baseScenario !== 'string' || req.body.baseScenario.length > 40000) throw Error('Scénario d’origine invalide.');
      script = model.normalize(req.body.script);
      scenario = model.serialize(script);
      order = model.order(req.body.sceneOrder);
      replacements=req.body.imageReplacements??[null,null,null,null];
      if(!Array.isArray(replacements)||replacements.length!==4)throw Error('Quatre emplacements de photos sont requis.');
      replacements.forEach((image,i)=>{if(image!==null){if(typeof image!=='string'||image.length>220000)throw Error('Photo trop volumineuse.');decodeImage(image,i);}});
    } catch (error) { return res.status(400).json({ok:false,error:error.message}); }
    const db = await pool.connect().catch(() => null);
    if (!db) return res.status(503).json({ok:false,error:'Sauvegarde indisponible. Vos modifications restent dans l’éditeur.'});
    try {
      await db.query('BEGIN');
      const {rows} = await db.query('SELECT * FROM vira_campaigns WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, req.user.id]);
      if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ok:false,error:'Campagne introuvable.'}); }
      const campaign = rows[0], data = campaign.campaign_data || {};
      if ((data.scenario || '') !== req.body.baseScenario) {
        await db.query('ROLLBACK');
        return res.status(409).json({ok:false,error:'La campagne a été modifiée ailleurs. Rouvrez-la avant d’enregistrer ; votre brouillon reste ici.'});
      }
      if(replacements.some(Boolean)&&data.sourceClips?.length){await db.query('ROLLBACK');return res.status(400).json({ok:false,error:'Remplacez les photos uniquement dans une campagne sans clips importés.'});}
      const previous = model.parse(data.scenario || '');
      const reordered = order.some((n, i) => n !== i);
      if (reordered) for (const key of ['generatedImages', 'sourceClips']) {
        if (Array.isArray(data[key]) && data[key].length && data[key].length !== 4) { await db.query('ROLLBACK'); return res.status(400).json({ok:false,error:'Complétez les quatre visuels avant de modifier leur ordre.'}); }
      }
      const changed = replacements.some(Boolean) || reordered || JSON.stringify(previous) !== JSON.stringify(script);
      if (!changed) { await db.query('COMMIT'); return res.json({ok:true,campaign,changed:false,audioInvalidated:false,videoInvalidated:false}); }
      const audioInvalidated = previous.narration !== script.narration ||
        (data.narration?.mode === 'auto' && data.narration.text?.trim() !== script.narration);
      const next = {...data, scenario, audience:script.target, goal:script.objective, tone:script.style,
        publicationDraft:{caption:script.publication, hashtags:script.hashtags}};
      if (reordered) for (const key of ['generatedImages', 'sourceClips']) {
        if (Array.isArray(data[key]) && data[key].length === 4) next[key] = order.map(i => data[key][i]);
      }
      if(reordered && data.exportSettings){
        next.exportSettings={...data.exportSettings};
        for(const key of ['sceneDurations','sceneColors','sceneText'])if(Array.isArray(data.exportSettings[key])&&data.exportSettings[key].length===4)next.exportSettings[key]=order.map(i=>data.exportSettings[key][i]);
      }
      if(replacements.some(Boolean)){
        next.generatedImages=order.map(i=>replacements[i]||data.generatedImages?.[i]||null);
        if(next.generatedImages.some(image=>!image)){await db.query('ROLLBACK');return res.status(400).json({ok:false,error:'Préparez les quatre photos avant d’enregistrer.'});}
      }
      if (audioInvalidated) next.narration = null;
      if (data.videoUrl) next.previousExport = {videoUrl:data.videoUrl, savedAt:new Date().toISOString()};
      delete next.videoUrl;
      delete next.completedAt;
      const status = next.generatedImages?.length === 4 || next.sourceClips?.length === 4 ? 'visuals_ready' : 'draft';
      const saved = await db.query(`UPDATE vira_campaigns SET title=$3,status=$4,campaign_data=$5::jsonb,updated_at=NOW()
        WHERE id=$1 AND user_id=$2 RETURNING *`, [id, req.user.id, script.title, status, JSON.stringify(next)]);
      await db.query('COMMIT');
      return res.json({ok:true,campaign:saved.rows[0],changed:true,audioInvalidated,videoInvalidated:true});
    } catch {
      await db.query('ROLLBACK').catch(() => {});
      return res.status(503).json({ok:false,error:'La sauvegarde a échoué. Vos modifications restent dans l’éditeur ; réessayez.'});
    } finally { db.release(); }
  });
}
