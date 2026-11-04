(()=>{
 const model=globalThis.olyvexExportModel;
 const panel=document.createElement('section');panel.id='exportOptions';panel.hidden=true;
 panel.innerHTML=`<header><span>PRÉPARER L’EXPORT</span><h3>Le bon format. Le bon message.</h3><p>Les visuels sont conservés en entier ; des marges s’ajoutent si nécessaire.</p></header>
 <label>Format vidéo<select id="exportFormat"><option value="portrait">Portrait · 9:16 · 720 × 1280</option><option value="square">Carré · 1:1 · 720 × 720</option><option value="landscape">Paysage · 16:9 · 1280 × 720</option></select></label>
 <div class="export-actions"><button type="button" id="captionGenerate">Synchroniser les sous-titres</button><button type="button" id="captionAdd">Ajouter une ligne manuellement</button></div>
 <p class="export-note">La synchronisation analyse votre voix avec OpenAI. Le même audio est réutilisé sans nouvel appel. Vérifiez les mots, les noms et les temps avant l’export.</p>
 <label class="export-checkbox"><input type="checkbox" id="captionEnabled">Intégrer les sous-titres dans la vidéo</label>
 <audio id="captionAudio" controls preload="metadata" aria-label="Écouter la narration pour vérifier les sous-titres"></audio>
 <div id="captionCues" aria-label="Éditeur des sous-titres"></div>
 <div class="export-actions"><button type="button" id="exportSave">Enregistrer les options</button><button type="button" id="captionSrt">Télécharger SRT</button><button type="button" id="captionVtt">Télécharger VTT</button></div>
 <p class="export-note">Chaque nouveau MP4 utilise un export de votre forfait. Modifier ces options et télécharger les sous-titres ne consomme aucun crédit vidéo.</p><p id="exportFeedback" role="status" aria-live="polite"></p>`;
 const videoButton=document.getElementById('video'),videoStatus=document.getElementById('videoStatus');
 videoStatus?.before(panel);if(videoButton)panel.after(videoButton);
 const el=id=>panel.querySelector('#'+id),status=text=>el('exportFeedback').textContent=text;
 let scope='',loaded=false,loading=false,busy=false,token=0,cues=[],automatic=false;
 const snapshot=()=>window.olyvexExportState?.()||{};
 function draw(){const box=el('captionCues');box.replaceChildren();if(cues.length){const guide=document.createElement('p');guide.className='export-note';guide.textContent='Pour chaque ligne : début et fin en secondes, puis texte à afficher.';box.append(guide);}cues.forEach((cue,i)=>{const row=document.createElement('div');row.className='caption-row';
  const label=document.createElement('strong');label.textContent=String(i+1);row.append(label);
  for(const key of ['start','end','text']){const field=document.createElement(key==='text'?'textarea':'input');if(key!=='text'){field.type='number';field.min='0';field.max='60';field.step='0.01';field.title=key==='start'?'Début en secondes':'Fin en secondes';}else{field.maxLength=100;field.rows=2;}field.value=cue[key];field.setAttribute('aria-label',`${key==='start'?'Début en secondes':key==='end'?'Fin en secondes':'Texte'} du sous-titre ${i+1}`);field.addEventListener('input',()=>{cue[key]=key==='text'?field.value:Number(field.value);status('Modifications à enregistrer.');});row.append(field);}
  const remove=document.createElement('button');remove.type='button';remove.textContent='Retirer';remove.setAttribute('aria-label',`Retirer le sous-titre ${i+1}`);remove.onclick=()=>{cues.splice(i,1);draw();};row.append(remove);box.append(row);});}
 async function api(url,method='GET',body){const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok||!data.ok)throw Error(data.error||'Opération indisponible. Réessayez.');return data;}
 function collect(){const s=snapshot();if(loading||!loaded)throw Error('Attendez le chargement des options avant l’export.');if(busy)throw Error('La synchronisation est en cours.');return model.normalize({format:el('exportFormat').value,captionsEnabled:el('captionEnabled').checked,audioId:s.audioId,cues});}
 async function save(settings=collect()){const s=snapshot(),before=scope;await api(`/api/campaigns/${encodeURIComponent(s.campaignId)}/export-settings`,'PATCH',{settings});if(scope===before)status('Options enregistrées. Aucun crédit vidéo utilisé.');return settings;}
 async function refresh(){const s=snapshot(),key=`${s.campaignId||''}:${s.audioId||''}`;panel.hidden=!s.campaignId||!s.audioId;
  if(key!==scope){scope=key;token++;loaded=false;loading=false;cues=[];draw();el('captionEnabled').checked=false;el('exportFormat').value='portrait';el('captionAudio').src=s.audioId?`/api/audio/${encodeURIComponent(s.audioId)}`:'';status('');}
  if(panel.hidden)return;
  if(!loaded&&!loading){loading=true;const current=token;try{const data=await api(`/api/campaigns/${encodeURIComponent(s.campaignId)}/export-settings`);if(current!==token)return;const saved=model.normalize(data.settings);el('exportFormat').value=saved.format;if(saved.audioId===s.audioId){cues=saved.cues;el('captionEnabled').checked=saved.captionsEnabled;}draw();loaded=true;}catch(error){if(current===token)status(error.message);}finally{if(current===token)loading=false;}}
  const locked=Boolean(s.busy||busy||loading||!loaded);panel.querySelectorAll('button,input,select,textarea').forEach(c=>c.disabled=locked);el('captionGenerate').disabled=locked||!automatic;
 }
 el('captionGenerate').onclick=async()=>{if(busy)return;const s=snapshot(),current=token;try{await window.olyvexScriptEditor?.settle();if(!window.olyvexProductionGuide)throw Error('Rechargez la page avant de synchroniser.');if(!await window.olyvexProductionGuide.confirm('captions')||current!==token)return;}catch(error){status(error.message);return;}busy=true;status('Écoute de la narration et création des repères…');await refresh();try{const data=await api('/api/audio/captions','POST',{audioId:s.audioId});if(current!==token)return;cues=data.cues;el('captionEnabled').checked=true;draw();status('Sous-titres synchronisés. Vérifiez-les puis enregistrez.');}catch(error){if(current===token)status(error.message);}finally{busy=false;await refresh();}};
 el('captionAdd').onclick=()=>{if(cues.length>=100)return status('Maximum 100 lignes.');const start=cues.at(-1)?.end||0;cues.push({start,end:Math.min(60,start+2),text:''});draw();status('Ajoutez le texte et les temps en écoutant la narration.');};
 el('exportSave').onclick=async()=>{try{await save();}catch(error){status(error.message);}};
 for(const [id,vtt]of [['captionSrt',false],['captionVtt',true]])el(id).onclick=()=>{try{const settings=collect();if(!settings.cues.length)throw Error('Ajoutez des sous-titres.');const url=URL.createObjectURL(new Blob([model.subtitles(settings.cues,vtt)],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`OLYVEX-sous-titres.${vtt?'vtt':'srt'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){status(error.message);}};
 window.olyvexExportUI={collect,save,isBusy:()=>busy};
 for(const event of ['olyvex:workflow-state','olyvex:campaign-saved'])window.addEventListener(event,()=>void refresh());
 api('/api/video/export-config').then(config=>{automatic=config.automaticCaptions;void refresh();}).catch(()=>{status('Synchronisation indisponible. La saisie manuelle reste possible.');void refresh();});void refresh();
})();
