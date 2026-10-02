(() => {
  'use strict';
  const t=(fr,en)=>document.documentElement.lang==='en'?en:fr;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
  const headers={'Content-Type':'application/json','X-Olyvex-Request':'1'};
  async function api(path,options={}) {
    const response=await fetch('/api/social/meta/'+path,{credentials:'same-origin',...options});
    let data;try{data=await response.json();}catch{throw Error(t('Réponse du serveur indisponible.','Server response unavailable.'));}
    if(!response.ok)throw Error(data.error || t('Opération impossible.','Operation failed.'));return data;
  }
  const button=(text,fn)=>{const b=node('button','vr-button',text);b.type='button';b.onclick=fn;return b;};
  async function connect(message,b) {
    b.disabled=true;message.textContent=t('Ouverture de Meta…','Opening Meta…');
    try {const data=await api('connect',{method:'POST',headers,body:'{}'});const url=new URL(data.url);if(url.origin!=='https://www.facebook.com')throw Error();location.assign(url.href);}
    catch(error){message.textContent=error.message;b.disabled=false;}
  }
  const statusLabels={queued:['En attente','Queued'],processing:['Envoi en cours','Sending'],waiting:['Préparation par le réseau','Processing by the network'],published:['Publié','Published'],failed:['Échec','Failed'],uncertain:['À vérifier sur le réseau','Check on the network'],cancelled:['Annulé','Cancelled']};
  function statusLabel(status){const labels=statusLabels[status] || [status,status];return t(...labels);}
  let panelTimer;
  async function renderPanel(grid) {
    const section=node('section','vr-panel ov-social-panel');section.append(node('h2','',t('Mes réseaux','My social accounts')));
    const message=node('p','');message.setAttribute('role','status');section.append(message);grid.append(section);
    const refresh=async()=>{
      try {
        const state=await api('status');if(!section.isConnected)return;
        section.replaceChildren(node('h2','',t('Mes réseaux','My social accounts')),message);
        if(!state.available){message.textContent=state.configured?t('Connexion en test privé.','Connection in private testing.'):t('Facebook et Instagram : configuration serveur en attente.','Facebook and Instagram: waiting for server configuration.');return;}
        message.textContent=state.testMode?t('Facebook et Instagram · test privé','Facebook and Instagram · private testing'):t('Facebook et Instagram','Facebook and Instagram');
        const connectButton=button(t('Connecter Facebook et Instagram','Connect Facebook and Instagram'),()=>connect(message,connectButton));section.append(connectButton);
        const data=await api('accounts');if(!section.isConnected)return;
        if(!data.accounts.length)section.append(node('p','',t('Aucun compte connecté. Une Page Facebook et un compte Instagram professionnel lié permettent de tester la publication.','No connected accounts. Use a Facebook Page and a linked professional Instagram account to test publishing.')));
        for(const account of data.accounts){const row=node('div','ov-social-account');row.append(node('span','',`${account.platform==='facebook'?'Facebook':'Instagram'} · ${account.display_name}`));
          row.append(button(t('Déconnecter','Disconnect'),async event=>{const clicked=event.currentTarget;clicked.disabled=true;try{await api('accounts/'+account.id,{method:'DELETE',headers});await refresh();}catch(error){message.textContent=error.message;clicked.disabled=false;}}));section.append(row);}
        const posts=await api('posts');if(!section.isConnected)return;
        if(posts.posts.length)section.append(node('h3','',t('Dernières publications','Recent publications')));
        for(const post of posts.posts.slice(0,10)){const row=node('div','ov-social-post');row.dataset.status=post.status;row.append(node('p','',`${post.display_name} · ${statusLabel(post.status)} · ${new Date(post.scheduled_at).toLocaleString()}`));if(post.error)row.append(node('p','ov-social-error',post.error));if(post.status==='queued')row.append(button(t('Annuler la publication','Cancel publication'),async()=>{try{await api('posts/'+post.id,{method:'DELETE',headers});await refresh();}catch(error){message.textContent=error.message;}}));section.append(row);}
      } catch(error){if(section.isConnected)message.textContent=error.message;}
    };
    await refresh();clearInterval(panelTimer);panelTimer=setInterval(()=>{if(!section.isConnected){clearInterval(panelTimer);return;}refresh();},15000);
  }
  window.olyvexSocialComposer=async campaign=>{
    const dialog=node('dialog','vr-lightbox ov-social-dialog');const form=node('form','ov-social-form');
    const top=node('div','vr-dialog-head');top.append(node('h2','',t('Publier sur mes réseaux','Publish to my accounts')),button('×',()=>dialog.close()));form.append(top);
    const message=node('p','');message.setAttribute('role','status');message.textContent=t('Chargement des comptes…','Loading accounts…');form.append(message);dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
    try {
      const state=await api('status');if(!dialog.isConnected)return;
      if(!state.available){message.textContent=t('La connexion Facebook et Instagram doit encore être activée.','Facebook and Instagram connection must still be enabled.');return;}
      const data=await api('accounts');if(!dialog.isConnected)return;
      if(!data.accounts.length){message.textContent=t('Connectez d’abord vos réseaux.','Connect your accounts first.');const b=button(t('Connecter Facebook et Instagram','Connect Facebook and Instagram'),()=>connect(message,b));form.append(b);return;}
      const field=(label,input)=>{const l=node('label','');l.append(node('span','',label),input);form.append(l);};
      const account=node('select');for(const a of data.accounts){const o=node('option','',`${a.platform==='facebook'?'Facebook':'Instagram'} · ${a.display_name}`);o.value=String(a.id);account.append(o);}field(t('Compte de destination','Destination account'),account);
      const media=node('select');const d=campaign.campaign_data || {};
      const choices=[];if(d.videoUrl)choices.push(['video',t('Vidéo enregistrée','Saved video')]);
      (d.generatedImages || []).forEach((source,index)=>{if(/^data:image\/(png|jpeg|webp);base64,/i.test(source))choices.push(['image:'+index,t('Image ','Image ')+(index+1)]);});choices.push(['text',t('Texte uniquement · Facebook','Text only · Facebook')]);
      for(const [value,label] of choices){const o=node('option','',label);o.value=value;media.append(o);}field(t('Contenu à publier','Content to publish'),media);
      const caption=node('textarea');caption.rows=5;caption.placeholder=t('Rédigez le texte de votre publication…','Write your caption…');field(t('Texte de publication','Post caption'),caption);
      const when=node('select');for(const [value,label] of [['now',t('Publier maintenant','Publish now')],['later',t('Programmer','Schedule')]]){const o=node('option','',label);o.value=value;when.append(o);}field(t('Quand publier ?','When to publish?'),when);
      const date=node('input');date.type='datetime-local';date.hidden=true;field(t('Date et heure locales','Local date and time'),date);when.onchange=()=>{date.hidden=when.value!=='later';date.required=when.value==='later';};
      const agree=node('input');agree.type='checkbox';agree.required=true;const consent=node('label','ov-social-consent');consent.append(agree,node('span','',t('J’ai vérifié le contenu et j’autorise sa publication sur ce compte.','I reviewed the content and authorize publishing it to this account.')));form.append(consent);
      const submit=node('button','vr-button',t('Confirmer la publication','Confirm publication'));submit.type='submit';form.append(submit);
      const progress=node('div','ov-social-progress');progress.hidden=true;progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');progress.setAttribute('aria-atomic','true');form.append(progress);
      const destination=()=>data.accounts.find(a=>String(a.id)===account.value)?.platform==='instagram'?'Instagram':'Facebook';
      const showProgress=(status,error='',scheduled=false)=>{
        progress.hidden=false;progress.dataset.status=status;
        const busy=['saving','queued','processing','waiting'].includes(status)&&!scheduled;
        progress.setAttribute('aria-busy',String(busy));progress.replaceChildren();
        const title=status==='saving'?t('Enregistrement de la publication…','Saving post…'):scheduled?t('Publication programmée','Post scheduled'):status==='processing'?t('Envoi vers ','Sending to ')+destination():status==='waiting'?t('Traitement par ','Processing by ')+destination():status==='queued'?t('En attente d’envoi','Waiting to send'):statusLabel(status);
        const heading=node('strong','',title);if(busy){const spinner=node('span','ov-social-spinner');spinner.setAttribute('aria-hidden','true');heading.prepend(spinner);}progress.append(heading);
        if(busy){const steps=node('ol','ov-social-steps');const stage={saving:0,queued:1,processing:1,waiting:2}[status];[t('Enregistrement','Save'),t('Envoi','Send'),t('Traitement','Process'),t('Publié','Published')].forEach((label,i)=>{const step=node('li','',label);step.dataset.state=i<stage?'done':i===stage?'active':'pending';if(i===stage)step.setAttribute('aria-current','step');steps.append(step);});progress.append(steps);}
        const detail=error|| (status==='published'?t('Publication confirmée par le réseau.','Publication confirmed by the network.'):status==='failed'?t('L’envoi a échoué. Consultez le détail dans Mes réseaux.','Sending failed. Check details in My social accounts.'):status==='uncertain'?t('Vérifiez le réseau avant de relancer la publication.','Check the network before sending again.'):t('Vous pouvez fermer cette fenêtre et retrouver le suivi dans Paramètres → Mes réseaux.','You can close this window and follow the status in Settings → My social accounts.'));
        progress.append(node('p','',detail));submit.textContent=busy?t('Publication en cours…','Publishing…'):scheduled?t('Publication programmée','Post scheduled'):statusLabel(status);
      };
      const update=()=>{const a=data.accounts.find(a=>String(a.id)===account.value);caption.maxLength=a.platform==='instagram'?2200:5000;submit.disabled=a.platform==='instagram'&&media.value==='text';message.textContent=submit.disabled?t('Instagram exige une image ou une vidéo.','Instagram requires an image or a video.'):t('La publication sera envoyée au compte sélectionné.','The post will be sent to the selected account.');};account.onchange=update;media.onchange=update;update();
      let requestId=crypto.randomUUID(),poll;
      // Editing after an uncertain response creates a distinct request only after
      // the user has checked the history; keep the current attempt immutable.
      form.onsubmit=async event=>{
        event.preventDefault();if(!form.reportValidity())return;
        const [kind,index]=media.value.split(':');const scheduledAt=when.value==='later'?new Date(date.value).toISOString():null;
        if(scheduledAt&&new Date(scheduledAt)<=new Date()){message.textContent=t('Choisissez une date future.','Choose a future date.');return;}
        const payload={campaignId:String(campaign.id),accountId:account.value,kind,imageIndex:Number(index || 0),caption:caption.value,scheduledAt,requestId};
        [...form.elements].forEach(el=>el.disabled=true);top.querySelector('button').disabled=false;message.hidden=true;showProgress('saving');progress.scrollIntoView({block:'nearest'});
        try {const result=await api('posts',{method:'POST',headers,body:JSON.stringify(payload)});if(!dialog.isConnected)return;showProgress(result.post.status,result.post.error,Boolean(scheduledAt));
          if(!scheduledAt){let polling=false;poll=setInterval(async()=>{if(!dialog.isConnected){clearInterval(poll);return;}if(polling)return;polling=true;try{const posts=await api('posts');if(!dialog.isConnected)return;const post=posts.posts.find(p=>p.id===result.post.id);if(post){showProgress(post.status,post.error);if(['published','failed','uncertain','cancelled'].includes(post.status))clearInterval(poll);}}catch{showProgress('uncertain',t('Suivi temporairement indisponible. Consultez Paramètres → Mes réseaux avant de renvoyer.','Tracking is temporarily unavailable. Check Settings → My social accounts before sending again.'));clearInterval(poll);}finally{polling=false;}},5000);dialog.addEventListener('close',()=>clearInterval(poll),{once:true});}
        }catch(error){if(dialog.isConnected)showProgress('uncertain',error.message+' '+t('Vérifiez Mes réseaux avant de renvoyer pour éviter un doublon.','Check My social accounts before resending to avoid duplicates.'));}
      };
    }catch(error){if(dialog.isConnected)message.textContent=error.message;}
  };
  const observe=()=>{const grid=document.querySelector('.vr-settings-grid');if(grid&&!grid.querySelector('.ov-social-panel'))renderPanel(grid);};
  new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});observe();
  const hash=location.hash.match(/^#social=(connected|empty|permissions|invalid|cancelled|failed)$/);
  if(hash){history.replaceState(null,'',location.pathname+location.search);const message={connected:t('Comptes connectés. Retrouvez-les dans Réglages → Mes réseaux.','Accounts connected. Find them in Settings → My social accounts.'),empty:t('Aucune Page Facebook autorisée. Vérifiez les comptes sélectionnés et le compte Instagram professionnel lié.','No authorized Facebook Page. Check the selected accounts and linked professional Instagram account.'),permissions:t('Autorisez l’accès à vos Pages pour connecter les comptes.','Authorize Page access to connect your accounts.'),invalid:t('Connexion expirée. Recommencez depuis Olyvex.','Connection expired. Start again from Olyvex.'),cancelled:t('Connexion Meta annulée.','Meta connection cancelled.'),failed:t('Connexion Meta impossible. Vérifiez la configuration et les autorisations.','Unable to connect Meta. Check configuration and permissions.')}[hash[1]];const d=node('dialog','vr-lightbox ov-social-dialog');d.append(node('p','',message),button(t('Fermer','Close'),()=>d.close()));document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();}
})();
