(()=>{
 const model=globalThis.olyvexExportModel;
 const panel=document.createElement('section');panel.id='exportOptions';panel.hidden=true;
 panel.innerHTML=`<header><span>PRÉPARER L’EXPORT</span><h3>Le bon format. Le bon message.</h3><p>Les visuels sont conservés en entier ; des marges s’ajoutent si nécessaire.</p></header>
 <section class="ep-preview" aria-label="Aperçu du montage"><h4>Aperçu des scènes</h4><div id="epCanvas"><span>Préparez vos visuels pour voir l’aperçu.</span></div><div class="export-actions"><button type="button" id="epPlay">Lire l’aperçu</button><button type="button" id="epRestart">Recommencer</button><span id="epTime" role="status"></span></div><div id="epScenes" aria-label="Choisir une scène"></div><p class="export-note">Aperçu silencieux des visuels et du rythme. Les clips sont représentés par leur miniature. Les mouvements, sous-titres et éléments de marque sont à vérifier dans le MP4 final.</p></section>
 <label>Format vidéo<select id="exportFormat"><option value="portrait">Portrait · 9:16 · 720 × 1280</option><option value="square">Carré · 1:1 · 720 × 720</option><option value="landscape">Paysage · 16:9 · 1280 × 720</option></select></label>
 <fieldset id="sceneExportSettings"><legend>Rythme et fonds des scènes</legend><label class="export-checkbox"><input type="checkbox" id="sceneTimingCustom">Choisir les durées des scènes</label><p class="export-note">Le total doit couvrir toute la narration, sans dépasser 60 secondes. Les couleurs remplissent les marges autour des visuels.</p><div id="sceneExportRows"></div><p id="sceneTotal" role="status"></p></fieldset>\n <div class="export-actions"><button type="button" id="captionGenerate">Synchroniser les sous-titres</button><button type="button" id="captionAdd">Ajouter une ligne manuellement</button></div>
 <p class="export-note">La synchronisation analyse votre voix avec OpenAI. Le même audio est réutilisé sans nouvel appel. Vérifiez les mots, les noms et les temps avant l’export.</p>
 <label class="export-checkbox"><input type="checkbox" id="captionEnabled">Intégrer les sous-titres dans la vidéo</label>
 <audio id="captionAudio" controls preload="metadata" aria-label="Écouter la narration pour vérifier les sous-titres"></audio>
 <div id="captionCues" aria-label="Éditeur des sous-titres"></div>
 <div class="export-actions"><button type="button" id="exportSave">Enregistrer les options</button><button type="button" id="captionSrt">Télécharger SRT</button><button type="button" id="captionVtt">Télécharger VTT</button></div>
 <p class="export-note">Chaque nouveau MP4 utilise un export de votre forfait. Modifier ces options et télécharger les sous-titres ne consomme aucun crédit vidéo.</p><p id="exportFeedback" role="status" aria-live="polite"></p>`;
 const videoButton=document.getElementById('video'),videoStatus=document.getElementById('videoStatus');
 videoStatus?.before(panel);if(videoButton)panel.after(videoButton);
 const el=id=>panel.querySelector('#'+id),status=text=>el('exportFeedback').textContent=text;
 const durationInputs=[],colorInputs=[];
 for(let i=0;i<4;i++){const row=document.createElement('div');row.className='caption-row';
 const title=document.createElement('strong');title.textContent='Scène '+(i+1);
 const duration=document.createElement('input');duration.type='number';duration.min=1;duration.max=30;duration.step=.1;duration.value=3;duration.setAttribute('aria-label','Durée en secondes de la scène '+(i+1));
 const color=document.createElement('input');color.type='color';color.value='#000000';color.setAttribute('aria-label','Couleur des marges de la scène '+(i+1));
 row.append(title,duration,color);el('sceneExportRows').append(row);durationInputs.push(duration);colorInputs.push(color);
 duration.oninput=color.oninput=()=>{timing();status('Modifications à enregistrer.');};}
 function timing(){const custom=el('sceneTimingCustom').checked;durationInputs.forEach(input=>input.disabled=!custom||busy||loading||!loaded||Boolean(snapshot().busy));el('sceneTotal').textContent=custom?'Durée totale : '+durationInputs.reduce((sum,input)=>sum+Number(input.value),0).toFixed(1)+' s':'Durée automatique adaptée à la voix.';}
 el('sceneTimingCustom').onchange=()=>{timing();status('Modifications à enregistrer.');};
 let scope='',loaded=false,loading=false,busy=false,token=0,cues=[],automatic=false;
 const snapshot=()=>window.olyvexExportState?.()||{};
 let previewVisualKey='', previewIndex=0,previewElapsed=0,previewPlaying=false,previewFrame=0,previewLast=0;
 function previewDurations(){return el('sceneTimingCustom').checked?durationInputs.map(input=>Number(input.value)):Array(4).fill((Number.isFinite(el('captionAudio').duration)?el('captionAudio').duration:12)/4);}
 function pausePreview(){previewPlaying=false;cancelAnimationFrame(previewFrame);el('epPlay').textContent='Lire l’aperçu';}
 function drawPreview(){
  const source=window.olyvexScriptEditor?.snapshot()||{},canvas=el('epCanvas');
  const format=model.formats[el('exportFormat').value]||model.formats.portrait;canvas.style.aspectRatio=format.width+'/'+format.height;canvas.style.backgroundColor=colorInputs[previewIndex].value;
  const image=source.clips?.[previewIndex]?.thumbnail||source.images?.[previewIndex];
  const visualKey=[previewIndex,format.width,format.height,colorInputs[previewIndex].value,image].join('|');
  if(visualKey!==previewVisualKey){previewVisualKey=visualKey;canvas.replaceChildren();
  if(typeof image==='string'&&/^data:image\/(jpeg|png|webp);base64,/i.test(image)){const img=document.createElement('img');img.src=image;img.alt='Scène '+(previewIndex+1);canvas.append(img);}
  else{const text=document.createElement('span');text.textContent='Scène '+(previewIndex+1)+' · Visuel à préparer';canvas.append(text);}
  }
  const durations=previewDurations(),total=durations.reduce((a,b)=>a+b,0);
  el('epTime').textContent='Scène '+(previewIndex+1)+' · '+previewElapsed.toFixed(1)+' / '+(Number.isFinite(total)?total.toFixed(1):'—')+' s';
  [...el('epScenes').children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===previewIndex)));
 }
 function resetPreview(){pausePreview();previewIndex=0;previewElapsed=0;drawPreview();}
 for(let i=0;i<4;i++){const button=document.createElement('button');button.type='button';button.textContent='Scène '+(i+1);button.onclick=()=>{pausePreview();previewIndex=i;previewElapsed=previewDurations().slice(0,i).reduce((a,b)=>a+b,0);drawPreview();};el('epScenes').append(button);}
 function tickPreview(now){
  if(!previewPlaying)return;
  if(document.hidden||!panel.getClientRects().length||snapshot().busy){pausePreview();return;}
  previewElapsed+=(now-previewLast)/1000;previewLast=now;
  const durations=previewDurations(),total=durations.reduce((a,b)=>a+b,0);
  if(previewElapsed>=total){previewElapsed=total;previewIndex=3;pausePreview();drawPreview();return;}
  let boundary=0;previewIndex=durations.findIndex(d=>(boundary+=d)>previewElapsed);drawPreview();previewFrame=requestAnimationFrame(tickPreview);
 }
 el('epPlay').onclick=()=>{if(previewPlaying){pausePreview();return;}try{const settings=collect();const durations=previewDurations(),total=durations.reduce((a,b)=>a+b,0);if(!Number.isFinite(total)||total<=0)throw Error('Vérifiez les durées.');if(previewElapsed>=total)previewElapsed=0;previewPlaying=true;el('epPlay').textContent='Mettre en pause';previewLast=performance.now();previewFrame=requestAnimationFrame(tickPreview);}catch(error){status(error.message);}};
 el('epRestart').onclick=resetPreview;
 panel.addEventListener('input',event=>{if(event.target.closest('#sceneExportSettings')||event.target.id==='exportFormat')resetPreview();});
 el('captionAudio').addEventListener('loadedmetadata',resetPreview);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pausePreview();});
 function draw(){const box=el('captionCues');box.replaceChildren();if(cues.length){const guide=document.createElement('p');guide.className='export-note';guide.textContent='Pour chaque ligne : début et fin en secondes, puis texte à afficher.';box.append(guide);}cues.forEach((cue,i)=>{const row=document.createElement('div');row.className='caption-row';
  const label=document.createElement('strong');label.textContent=String(i+1);row.append(label);
  for(const key of ['start','end','text']){const field=document.createElement(key==='text'?'textarea':'input');if(key!=='text'){field.type='number';field.min='0';field.max='60';field.step='0.01';field.title=key==='start'?'Début en secondes':'Fin en secondes';}else{field.maxLength=100;field.rows=2;}field.value=cue[key];field.setAttribute('aria-label',`${key==='start'?'Début en secondes':key==='end'?'Fin en secondes':'Texte'} du sous-titre ${i+1}`);field.addEventListener('input',()=>{cue[key]=key==='text'?field.value:Number(field.value);status('Modifications à enregistrer.');});row.append(field);}
  const remove=document.createElement('button');remove.type='button';remove.textContent='Retirer';remove.setAttribute('aria-label',`Retirer le sous-titre ${i+1}`);remove.onclick=()=>{cues.splice(i,1);draw();};row.append(remove);box.append(row);});}
 async function api(url,method='GET',body){const r=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok||!data.ok)throw Error(data.error||'Opération indisponible. Réessayez.');return data;}
 function collect(){const s=snapshot();if(loading||!loaded)throw Error('Attendez le chargement des options avant l’export.');if(busy)throw Error('La synchronisation est en cours.');return model.normalize({format:el('exportFormat').value,captionsEnabled:el('captionEnabled').checked,audioId:s.audioId,cues,sceneDurations:el('sceneTimingCustom').checked?durationInputs.map(input=>Number(input.value)):null,sceneColors:colorInputs.map(input=>input.value)});}
 async function save(settings=collect()){const s=snapshot(),before=scope;await api(`/api/campaigns/${encodeURIComponent(s.campaignId)}/export-settings`,'PATCH',{settings});if(scope===before)status('Options enregistrées. Aucun crédit vidéo utilisé.');return settings;}
 async function refresh(){const s=snapshot(),key=`${s.campaignId||''}:${s.audioId||''}`;panel.hidden=!s.campaignId||!s.audioId;
  if(key!==scope){pausePreview();previewIndex=0;previewElapsed=0;scope=key;token++;loaded=false;loading=false;cues=[];draw();el('captionEnabled').checked=false;el('exportFormat').value='portrait';el('sceneTimingCustom').checked=false;durationInputs.forEach(input=>input.value=3);colorInputs.forEach(input=>input.value='#000000');el('captionAudio').src=s.audioId?`/api/audio/${encodeURIComponent(s.audioId)}`:'';status('');}
  if(panel.hidden){pausePreview();return;}
  if(!loaded&&!loading){loading=true;const current=token;try{const data=await api(`/api/campaigns/${encodeURIComponent(s.campaignId)}/export-settings`);if(current!==token)return;const saved=model.normalize(data.settings);el('exportFormat').value=saved.format;el('sceneTimingCustom').checked=!!saved.sceneDurations;durationInputs.forEach((input,i)=>input.value=saved.sceneDurations?.[i]??3);colorInputs.forEach((input,i)=>input.value=saved.sceneColors[i]);if(saved.audioId===s.audioId){cues=saved.cues;el('captionEnabled').checked=saved.captionsEnabled;}draw();loaded=true;}catch(error){if(current===token)status(error.message);}finally{if(current===token)loading=false;}}
  const locked=Boolean(s.busy||busy||loading||!loaded);panel.querySelectorAll('button,input,select,textarea').forEach(c=>c.disabled=locked);el('captionGenerate').disabled=locked||!automatic;timing();drawPreview();
 }
 el('captionGenerate').onclick=async()=>{if(busy)return;const s=snapshot(),current=token;try{await window.olyvexScriptEditor?.settle();if(!window.olyvexProductionGuide)throw Error('Rechargez la page avant de synchroniser.');if(!await window.olyvexProductionGuide.confirm('captions')||current!==token)return;}catch(error){status(error.message);return;}busy=true;status('Écoute de la narration et création des repères…');await refresh();try{const data=await api('/api/audio/captions','POST',{audioId:s.audioId});if(current!==token)return;cues=data.cues;el('captionEnabled').checked=true;draw();status('Sous-titres synchronisés. Vérifiez-les puis enregistrez.');}catch(error){if(current===token)status(error.message);}finally{busy=false;await refresh();}};
 el('captionAdd').onclick=()=>{if(cues.length>=100)return status('Maximum 100 lignes.');const start=cues.at(-1)?.end||0;cues.push({start,end:Math.min(60,start+2),text:''});draw();status('Ajoutez le texte et les temps en écoutant la narration.');};
 el('exportSave').onclick=async()=>{try{await save();}catch(error){status(error.message);}};
 for(const [id,vtt]of [['captionSrt',false],['captionVtt',true]])el(id).onclick=()=>{try{const settings=collect();if(!settings.cues.length)throw Error('Ajoutez des sous-titres.');const url=URL.createObjectURL(new Blob([model.subtitles(settings.cues,vtt)],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`OLYVEX-sous-titres.${vtt?'vtt':'srt'}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){status(error.message);}};
 window.olyvexExportUI={collect,save,isBusy:()=>busy};
 for(const event of ['olyvex:workflow-state','olyvex:campaign-saved'])window.addEventListener(event,()=>void refresh());
 api('/api/video/export-config').then(config=>{automatic=config.automaticCaptions;void refresh();}).catch(()=>{status('Synchronisation indisponible. La saisie manuelle reste possible.');void refresh();});void refresh();
})();
