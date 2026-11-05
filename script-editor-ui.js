(function () {
  'use strict';
  const model = window.olyvexScriptModel;
  const dialog = document.createElement('dialog');
  dialog.id = 'olyvexScriptDialog';
  dialog.setAttribute('aria-labelledby', 'scriptEditorTitle');
  dialog.innerHTML = `<form id="scriptEditorForm">
    <header class="se-header"><div><span class="se-eyebrow">STUDIO DE CAMPAGNE</span><h2 id="scriptEditorTitle">Votre campagne, scène par scène.</h2><p>Adaptez le message et l’ordre des visuels avant de produire votre vidéo.</p></div><button type="button" id="scriptEditorClose" aria-label="Fermer l’éditeur sans enregistrer">×</button></header>
    <div class="se-content"><section class="se-fields" id="scriptEditorMessage" aria-label="Message de la campagne"></section>
    <section><div class="se-section-head"><div><h3>Les quatre scènes</h3><p>Les descriptions et leurs visuels se déplacent ensemble. Modifier une description ne régénère pas son visuel.</p></div><button type="button" id="scriptEditorResetOrder">Rétablir l’ordre initial</button></div><div class="se-toolbar"><button type="button" id="seUndo">Annuler</button><button type="button" id="seRedo">Rétablir</button><span>Modifications avant enregistrement</span></div><div id="sePreview" class="se-preview" aria-label="Aperçu de la scène sélectionnée"></div><div class="se-scenes" id="scriptEditorScenes"></div></section>
    <section id="scriptEditorVoice"><h3>La narration</h3><p>Si vous changez les mots à prononcer, préparez une nouvelle voix après la sauvegarde.</p></section>
    <details class="se-details"><summary>Texte de publication et hashtags</summary><div class="se-fields" id="scriptEditorPublication"></div></details>
    <details class="se-details"><summary>Stratégie et direction visuelle</summary><div class="se-fields" id="scriptEditorStrategy"></div></details>
    <a id="scriptEditorPrevious" hidden target="_blank" rel="noopener noreferrer">Ouvrir l’export précédent</a></div>
    <footer class="se-footer"><div><p id="scriptEditorFeedback" role="status" aria-live="polite"></p><small>La modification du scénario ne consomme aucun crédit. Une nouvelle génération ou un nouvel export suit les règles de votre forfait.</small></div><button type="submit" id="scriptEditorSave">Enregistrer les modifications</button></footer>
  </form>`;
  document.body.append(dialog);
  const byId = id => document.getElementById(id);
  let snapshot, order, scenes, saving = false;
  const inputs = new Map();
  let selected = 0, history = [], future = [], replacements = [null,null,null,null], importing = false, editSession = 0;
  const capture = () => JSON.stringify({scenes, order, replacements, values:Object.fromEntries([...inputs].map(([k,v])=>[k,v.value]))});
  function historyButtons() { byId('seUndo').disabled=saving||history.length<2; byId('seRedo').disabled=saving||!future.length; }
  function remember() { const value=capture(); if(history.at(-1)!==value){history.push(value);if(history.length>80)history.shift();future=[];} historyButtons(); }
  function restore(value) { const saved=JSON.parse(value);scenes=saved.scenes;order=saved.order;replacements=saved.replacements||[null,null,null,null];for(const [key,val] of Object.entries(saved.values))inputs.get(key).value=val;renderScenes();historyButtons(); }
  function preview() {
    const target=byId('sePreview');target.replaceChildren();
    const title=document.createElement('h3');title.textContent='Scène '+(selected+1);
    const media=byId('scriptEditorScenes').children[selected]?.querySelector('.se-media')?.cloneNode(true);
    const copy=document.createElement('p');copy.textContent=scenes[selected];
    const note=document.createElement('small');note.textContent='Aperçu du visuel et de sa description. La description ne constitue pas un texte incrusté dans la vidéo.';
    target.append(title);if(media)target.append(media);target.append(copy,note);
    [...byId('scriptEditorScenes').children].forEach((card,i)=>{card.classList.toggle('se-selected',i===selected);card.querySelector('.se-select').setAttribute('aria-pressed',String(i===selected));});
  }
  byId('seUndo').onclick=()=>{if(history.length>1){future.push(history.pop());restore(history.at(-1));}};
  byId('seRedo').onclick=()=>{if(future.length){const next=future.pop();history.push(next);restore(next);}};
  byId('scriptEditorForm').addEventListener('change',()=>{if(!saving)remember();});

  function field(key, label, max, target, rows = 2) {
    const wrap = document.createElement('label');
    wrap.className = 'se-field';
    const title = document.createElement('span'); title.textContent = label;
    const input = document.createElement(key === 'title' ? 'input' : 'textarea');
    input.id = 'scriptField_' + key; input.maxLength = max;
    if (input.tagName === 'TEXTAREA') input.rows = rows;
    input.value = snapshot.script[key] || '';
    input.setAttribute('data-user-content', '');
    wrap.append(title, input); target.append(wrap); inputs.set(key, input);
    return input;
  }
  function renderScenes() {
    byId('scriptEditorScenes').replaceChildren();
    scenes.forEach((scene, index) => {
      const card = document.createElement('article'); card.className = 'se-scene';
      const heading = document.createElement('button'); heading.type='button'; heading.className='se-select'; heading.textContent = 'Scène ' + (index + 1); heading.onclick=()=>{selected=index;preview();};
      const media = document.createElement('div'); media.className = 'se-media';
      const source = replacements[order[index]] || snapshot.clips[order[index]]?.thumbnail || snapshot.images[order[index]];
      if (typeof source === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(source)) {
        const image = document.createElement('img'); image.src = source; image.alt = 'Visuel de la scène ' + (index + 1); media.append(image);
      } else { const label = document.createElement('span'); label.textContent = snapshot.clips[order[index]] ? 'Clip importé' : 'Visuel à préparer'; media.append(label); }
      const label = document.createElement('label'); label.className = 'se-field';
      const name = document.createElement('span'); name.textContent = 'Description de la scène ' + (index + 1);
      const input = document.createElement('textarea'); input.rows = 4; input.maxLength = 3000; input.value = scene; input.required = true;
      input.setAttribute('data-user-content', ''); input.oninput = () => { scenes[index] = input.value; selected=index; preview(); };
      label.append(name, input);
      const controls = document.createElement('div'); controls.className = 'se-move';
      for (const [delta, text] of [[-1, '← Avant'], [1, 'Après →']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
        button.disabled = index + delta < 0 || index + delta > 3 || saving;
        button.setAttribute('aria-label', 'Déplacer la scène ' + (index + 1) + (delta < 0 ? ' avant' : ' après'));
        button.onclick = () => {
          [scenes[index], scenes[index + delta]] = [scenes[index + delta], scenes[index]];
          [order[index], order[index + delta]] = [order[index + delta], order[index]];
          selected=index+delta; remember(); renderScenes(); byId('scriptEditorScenes').children[index + delta].querySelector('textarea').focus();
        };
        controls.append(button);
      }
      const uploadLabel=document.createElement('label');uploadLabel.className='se-field';
      const uploadTitle=document.createElement('span');uploadTitle.textContent='Remplacer la photo';
      const upload=document.createElement('input');upload.type='file';upload.accept='image/jpeg,image/png,image/webp';upload.disabled=!!snapshot.clips.length||saving||importing;
      upload.setAttribute('aria-label','Remplacer la photo de la scène '+(index+1));
      upload.onchange=async()=>{
        const file=upload.files[0];if(!file)return;const session=editSession,slot=order[index];importing=true;byId('scriptEditorSave').disabled=true;
        try{
          if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choisissez une photo JPEG, PNG ou WebP de 10 Mo maximum.');
          const bitmap=await createImageBitmap(file);
          let result;
          try{
            const canvas=document.createElement('canvas');const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
            const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
            for(const quality of [.85,.7,.55,.4]){result=canvas.toDataURL('image/jpeg',quality);if(result.length<=220000)break;}
            if(result.length>220000)throw Error('Cette photo est trop détaillée. Choisissez une image plus légère.');
          }finally{bitmap.close();}
          if(session!==editSession||!dialog.open)return;
          replacements[slot]=result;remember();renderScenes();byId('scriptEditorFeedback').textContent='Photo remplacée dans le brouillon. Enregistrez pour l’utiliser dans le prochain export.';
        }catch(error){if(session===editSession)byId('scriptEditorFeedback').textContent=error.message;}
        finally{importing=false;if(session===editSession){byId('scriptEditorSave').disabled=saving;renderScenes();}}
      };
      uploadLabel.append(uploadTitle,upload);
      if(snapshot.clips.length){const note=document.createElement('small');note.textContent='Le remplacement de photo est disponible pour les campagnes utilisant des images, sans clips importés.';uploadLabel.append(note);}
      card.append(heading, media, label, uploadLabel, controls); byId('scriptEditorScenes').append(card);
    });
    preview(); historyButtons();
  }
  function previousExport(url) {
    const link = byId('scriptEditorPrevious');
    link.hidden = typeof url !== 'string' || !/^\/videos\/vira-[A-Za-z0-9_-]+\.mp4$/.test(url);
    if (!link.hidden) link.href = url; else link.removeAttribute('href');
  }
  function openEditor() {
    snapshot = window.olyvexScriptEditor?.snapshot();
    if (!snapshot?.canEdit) return;
    editSession++; replacements=[null,null,null,null];
    order = [0, 1, 2, 3]; scenes = snapshot.script.scenes.slice(); inputs.clear();
    for (const id of ['scriptEditorMessage', 'scriptEditorPublication', 'scriptEditorStrategy']) byId(id).replaceChildren();
    byId('scriptEditorVoice').querySelector('.se-field')?.remove();
    field('title', 'Titre de la campagne', 160, byId('scriptEditorMessage')).required = true;
    field('hook', 'Accroche', 500, byId('scriptEditorMessage'));
    field('cta', 'Appel à l’action', 500, byId('scriptEditorMessage'));
    const narration = field('narration', 'Texte à prononcer · 800 caractères maximum', 800, byId('scriptEditorVoice'), 4);
    narration.setAttribute('aria-describedby', 'scriptEditorFeedback');
    field('publication', 'Texte de publication', 5000, byId('scriptEditorPublication'), 4);
    field('hashtags', 'Hashtags', 2200, byId('scriptEditorPublication'));
    for (const [key, label, max] of [['objective', 'Objectif', 1000], ['target', 'Public cible', 1000], ['visualPrompt', 'Direction visuelle', 3000], ['style', 'Style', 120]]) field(key, label, max, byId('scriptEditorStrategy'));
    byId('scriptEditorFeedback').textContent = 'Vos modifications seront sauvegardées lorsque vous cliquerez sur Enregistrer.';
    selected=0; history=[]; future=[]; remember(); previousExport(null); renderScenes(); dialog.showModal(); inputs.get('title').focus();
  }
  function buttons() {
    const ready = window.olyvexScriptEditor?.snapshot()?.canEdit;
    document.querySelectorAll('[data-script-editor-open]').forEach(button => { button.disabled = !ready; });
  }
  document.addEventListener('click', event => { if (event.target.closest('[data-script-editor-open]')) openEditor(); });
  for (const name of ['olyvex:script-ready', 'olyvex:campaign-saved', 'olyvex:workflow-state']) window.addEventListener(name, buttons);
  byId('scriptEditorClose').onclick = () => { if (!saving) { editSession++; dialog.close(); } };
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else editSession++; });
  byId('scriptEditorResetOrder').onclick = () => {
    const original = [0, 1, 2, 3].map(index => scenes[order.indexOf(index)]);
    scenes = original; order = [0, 1, 2, 3]; remember(); renderScenes();
  };
  byId('scriptEditorForm').onsubmit = async event => {
    event.preventDefault(); if (saving || importing) return;
    let script;
    try { script = model.normalize({...Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])), scenes}); }
    catch (error) { byId('scriptEditorFeedback').textContent = error.message; return; }
    saving = true; dialog.querySelectorAll('button,input,textarea').forEach(input => { input.disabled = true; });
    byId('scriptEditorFeedback').textContent = 'Sauvegarde en cours…';
    try {
      await window.olyvexScriptEditor.settle();
      const response = await fetch('/api/campaigns/' + encodeURIComponent(snapshot.campaignId) + '/script', {
        method:'PATCH', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({baseScenario:snapshot.baseScenario, script, sceneOrder:order, imageReplacements:replacements})
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Le service est temporairement indisponible. Vos modifications sont conservées ici.');
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || 'Sauvegarde impossible. Réessayez.');
      window.olyvexScriptEditor.apply(result);
      snapshot = window.olyvexScriptEditor.snapshot();
      scenes = snapshot.script.scenes.slice(); order = [0, 1, 2, 3];
      replacements=[null,null,null,null]; history=[]; future=[]; remember();
      previousExport(result.campaign.campaign_data.previousExport?.videoUrl);
      byId('scriptEditorFeedback').textContent = result.changed ? 'Modifications enregistrées. Aucun crédit utilisé.' + (result.audioInvalidated ? ' Préparez une nouvelle narration avant le prochain export.' : '') : 'Le scénario est déjà à jour. Aucun crédit utilisé.';
    } catch (error) { byId('scriptEditorFeedback').textContent = error.message; }
    finally { saving = false; dialog.querySelectorAll('button,input,textarea').forEach(input => { input.disabled = false; }); renderScenes(); buttons(); }
  };
  buttons();
})();
