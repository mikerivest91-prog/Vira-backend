(() => {
  'use strict';
  const headers={'Content-Type':'application/json','X-Olyvex-Request':'1'};
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  async function api(route,options={}) {const r=await fetch('/api/social/tiktok/'+route,{credentials:'same-origin',...options});const data=await r.json();if(!r.ok)throw Error(data.error||'TikTok indisponible.');return data;}
  const button=(text,fn)=>{const b=el('button',text);b.className='vr-button';b.type='button';b.onclick=fn;return b;};
  async function render(grid){const section=el('section');section.className='vr-panel ov-tiktok-panel';const message=el('p');message.setAttribute('role','status');grid.append(section);
    async function refresh(){section.replaceChildren(el('h2','TikTok'),message);try{const state=await api('status');if(!section.isConnected)return;if(!state.available){message.textContent=state.configured?'TikTok est en test privé.':'TikTok : configuration Render en attente.';return;}
      message.textContent='Connectez votre compte TikTok pour préparer les essais.';
      const connect=button('Connecter TikTok',async()=>{connect.disabled=true;try{const data=await api('connect',{method:'POST',headers,body:'{}'});const u=new URL(data.url);if(u.origin!=='https://www.tiktok.com')throw Error('Adresse invalide.');location.assign(u.href);}catch(e){message.textContent=e.message;connect.disabled=false;}});section.append(connect);
      const data=await api('accounts');if(!section.isConnected)return;for(const account of data.accounts){const row=el('div');row.className='ov-social-account';row.append(el('span','TikTok · '+account.display_name));const disconnect=button('Déconnecter',async()=>{disconnect.disabled=true;try{await api('accounts/'+account.id,{method:'DELETE',headers});await refresh();}catch(e){message.textContent=e.message;disconnect.disabled=false;}});row.append(disconnect);section.append(row);}
      section.append(el('p','Depuis la bibliothèque, envoyez une vidéo puis terminez sa publication dans la boîte de réception TikTok.'));
      section.append(button('Actualiser le suivi TikTok',refresh));const history=await api('uploads');if(!section.isConnected)return;for(const job of history.uploads){section.append(el('p',job.error||label(job.status)));}
    }catch(e){message.textContent=e.message;}}
    await refresh();
  }
  function observe(){const grid=document.querySelector('.vr-settings-grid');if(grid&&!grid.querySelector('.ov-tiktok-panel'))render(grid);}
  new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});observe();
  function label(status){return {queued:'En attente d’envoi',uploading:'Transfert vers TikTok en cours…',processing:'Vidéo reçue, traitement par TikTok…',inbox:'Brouillon prêt : ouvrez la notification dans votre boîte de réception TikTok pour modifier et publier.',published:'Publication terminée dans TikTok',failed:'Échec de l’envoi',uncertain:'Envoi à vérifier dans TikTok'}[status]||status;}
  window.olyvexTikTokComposer=async campaign=>{
    const d=el('dialog');d.className='vr-lightbox ov-social-dialog';const form=el('form');form.className='ov-social-form';const head=el('div');head.className='vr-dialog-head';head.append(el('h2','Envoyer une vidéo vers TikTok'),button('×',()=>d.close()));form.append(head);
    const message=el('p','Chargement…');message.setAttribute('role','status');form.append(message);d.append(form);document.body.append(d);let poll;
    d.addEventListener('close',()=>{clearInterval(poll);d.remove();},{once:true});d.showModal();
    try{const accounts=await api('accounts');if(!d.isConnected)return;if(!accounts.accounts.length){message.textContent='Connectez TikTok dans Paramètres avant cet envoi.';return;}
      message.textContent='Cette vidéo sera envoyée comme brouillon. Ouvrez ensuite la notification dans la boîte de réception TikTok pour ajouter le texte, modifier et publier.';
      const select=el('select');for(const a of accounts.accounts){const option=el('option','TikTok · '+a.display_name);option.value=a.id;select.append(option);}const field=el('label','Compte de destination');field.append(select);form.append(field);
      const preview=el('video');preview.controls=true;preview.preload='metadata';preview.style.maxWidth='100%';const u=new URL(campaign.campaign_data?.videoUrl||'',location.origin);if(u.origin!==location.origin||!/^\/videos\/vira-[a-zA-Z0-9_-]+\.mp4$/.test(u.pathname))throw Error('Vidéo enregistrée indisponible.');preview.src=u.href;form.append(preview);
      const agree=el('input');agree.type='checkbox';agree.required=true;const consent=el('label');consent.className='ov-social-consent';consent.append(agree,el('span','J’ai vérifié cette vidéo et j’autorise son envoi comme brouillon à ce compte TikTok.'));form.append(consent);
      const submit=el('button','Confirmer l’envoi');submit.type='submit';submit.className='vr-button';form.append(submit);const progress=el('div');progress.className='ov-social-progress';progress.hidden=true;progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');form.append(progress);
      function show(job){progress.hidden=false;progress.replaceChildren();progress.dataset.status=['queued','uploading','processing'].includes(job.status)?'processing':job.status==='inbox'||job.status==='published'?'published':'uncertain';if(['queued','uploading','processing'].includes(job.status)){const spinner=el('span');spinner.className='ov-social-spinner';spinner.setAttribute('aria-hidden','true');progress.append(spinner);}progress.append(el('p',job.error||label(job.status)));}
      const requestId=crypto.randomUUID();let sending=false;
      form.onsubmit=async e=>{e.preventDefault();if(sending||!form.reportValidity())return;sending=true;submit.disabled=true;select.disabled=true;agree.disabled=true;show({status:'queued'});progress.scrollIntoView({block:'nearest'});
        try{const data=await api('uploads',{method:'POST',headers,body:JSON.stringify({campaignId:campaign.id,accountId:select.value,requestId,confirm:true})});if(!d.isConnected)return;show(data.upload);let pending=false;const started=Date.now();poll=setInterval(async()=>{if(Date.now()-started>10*60*1000){clearInterval(poll);return;}if(pending||!d.isConnected)return;pending=true;try{const result=await api('uploads/'+data.upload.id);if(!d.isConnected)return;show(result.upload);if(['inbox','published','failed'].includes(result.upload.status))clearInterval(poll);}catch{show({status:'uncertain',error:'Suivi indisponible. Vérifiez Paramètres et TikTok avant de renvoyer.'});clearInterval(poll);}finally{pending=false;}},5000);
        }catch(e){if(d.isConnected)show({status:'uncertain',error:e.message+' Vérifiez les derniers envois dans Paramètres avant de renvoyer.'});}
      };
    }catch(e){message.textContent=e.message;}
  };
  const result=location.hash.match(/^#tiktok=(connected|invalid|cancelled|permissions|failed)$/);if(result){history.replaceState(null,'',location.pathname+location.search);const messages={connected:'Compte TikTok connecté. Retrouvez-le dans Paramètres.',invalid:'Connexion expirée. Recommencez depuis Olyvex.',cancelled:'Connexion TikTok annulée.',permissions:'Autorisez l’accès au profil TikTok.',failed:'Connexion TikTok impossible. Vérifiez les identifiants, les permissions et le compte de test.'};const d=el('dialog');d.className='vr-lightbox ov-social-dialog';d.append(el('p',messages[result[1]]),button('Fermer',()=>d.close()));document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();}
})();
