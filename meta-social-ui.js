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

(() => {
  'use strict';
  const make=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const action=(text,fn)=>{const b=make('button',text,'vr-button');b.type='button';b.onclick=fn;return b;};
  const style=make('style');style.textContent=`
  dialog.ov-publish{box-sizing:border-box!important;width:min(760px,calc(100% - 24px))!important;max-height:calc(100dvh - 24px)!important;padding:24px!important;border-radius:18px;font:16px/1.5 'Segoe UI',sans-serif;color:#253047;background:white;overflow:auto}
  .ov-publish header{display:flex;justify-content:space-between;align-items:center;gap:16px}.ov-publish h2{font-size:23px;margin:0}.ov-publish h3{font-size:18px;margin:0 0 14px}.ov-publish p{margin:10px 0}.ov-publish .ov-pub-steps{display:flex;gap:8px;list-style:none;padding:0;margin:20px 0}.ov-pub-steps li{flex:1;text-align:center;background:#f2f4f8;border-radius:10px;padding:10px 5px;font-size:13px}.ov-pub-steps li[aria-current]{background:#eee7ff;color:#6339a6;font-weight:600}
  .ov-pub-panel{border:1px solid #e1e5ed;border-radius:14px;padding:18px}.ov-publish label{display:grid;gap:8px;margin:12px 0}.ov-publish .ov-pub-account,.ov-publish .ov-pub-consent{display:flex;align-items:flex-start;gap:12px}.ov-publish input[type=checkbox]{width:20px;height:20px;flex-shrink:0;accent-color:#7647d4}.ov-publish select,.ov-publish textarea,.ov-publish input[type=datetime-local]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bac4d2;border-radius:9px;font:inherit;color:inherit;background:white}.ov-publish textarea{resize:vertical}.ov-publish video,.ov-publish img{display:block;width:100%!important;height:min(32dvh,280px)!important;object-fit:contain!important;border-radius:10px;background:#101827}.ov-publish footer{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:12px;padding:16px 0 0;background:white;z-index:2}.ov-publish footer button{min-height:46px;padding:12px 18px!important;border-radius:10px!important}.ov-publish .ov-pub-primary{background:#7647d4!important;color:white!important;border-color:#7647d4!important}.ov-publish button:disabled{opacity:.6;cursor:default}.ov-publish [hidden]{display:none!important}.ov-pub-note{color:#58677f;font-size:14px}.ov-pub-error{color:#a12739}.ov-pub-result{margin:12px 0;padding:14px;border:1px solid #e1e5ed;border-radius:12px;background:#f5f3ff}.ov-pub-result[data-state=published],.ov-pub-result[data-state=inbox]{background:#effaf3;border-color:#b8ddc5}.ov-pub-result[data-state=failed],.ov-pub-result[data-state=uncertain]{background:#fff6eb;border-color:#e7c9a0}
  @media(max-width:480px){dialog.ov-publish{padding:16px!important}.ov-publish h2{font-size:19px}.ov-pub-steps li{font-size:11px}.ov-pub-panel{padding:12px}.ov-publish footer{flex-wrap:wrap}.ov-publish footer button{flex:1}}
  `;document.head.append(style);
  const headers={'Content-Type':'application/json','X-Olyvex-Request':'1'};
  async function api(network,path,options={}){const r=await fetch('/api/social/'+network+'/'+path,{credentials:'same-origin',...options});let data;try{data=await r.json();}catch{throw Error('Réponse du serveur indisponible.');}if(!r.ok)throw Error(data.error||'Opération indisponible.');return data;}
  const names={facebook:'Facebook',instagram:'Instagram',tiktok:'TikTok'};
  const labels={queued:'En attente d’envoi',processing:'Traitement en cours',uploading:'Transfert vers TikTok',waiting:'Préparation par le réseau',published:'Publication confirmée',inbox:'Brouillon reçu par TikTok',failed:'Échec de l’envoi',uncertain:'Résultat à vérifier',cancelled:'Publication annulée'};
  window.olyvexSocialComposer=async campaign=>{
    const d=make('dialog','','vr-lightbox ov-social-dialog ov-publish');d.setAttribute('aria-label','Publication sur vos réseaux');const form=make('form');const head=make('header');head.append(make('h2','Publier sur vos réseaux'),action('Fermer',()=>d.close()));form.append(head,make('p','Préparez votre contenu et suivez chaque destination, étape par étape.','ov-pub-note'));const message=make('p','Chargement des comptes…');message.setAttribute('role','status');form.append(message);d.append(form);document.body.append(d);let timer,sending=false;d.addEventListener('close',()=>{clearInterval(timer);d.remove();},{once:true});d.showModal();
    const results=await Promise.allSettled([api('meta','accounts'),api('tiktok','accounts')]);if(!d.isConnected)return;
    const accounts=[];results.forEach((r,i)=>{if(r.status==='fulfilled')for(const a of r.value.accounts||[])accounts.push({...a,network:i?'tiktok':'meta',platform:i?'tiktok':a.platform});});
    const notices=results.map((r,i)=>r.status==='rejected'?(i?'TikTok':'Facebook et Instagram')+' : '+r.reason.message:'').filter(Boolean);
    message.textContent=notices.join(' · ');if(!accounts.length){message.textContent='Connectez vos comptes dans Paramètres → Mes réseaux avant de publier.';return;}
    const steps=make('ol','','ov-pub-steps');const titles=['Réseaux','Contenu','Confirmation','Suivi'];const stepItems=titles.map((name,i)=>{const n=make('li',(i+1)+'. '+name);steps.append(n);return n;});form.append(steps);
    const panels=titles.map((name,i)=>{const n=make('section','','ov-pub-panel');const h=make('h3',(i+1)+'. '+name);h.tabIndex=-1;n.append(h);form.append(n);return n;});
    const fields=[];for(const a of accounts){const l=make('label','','ov-pub-account');const c=make('input');c.type='checkbox';const text=make('span',names[a.platform]+' · '+a.display_name);l.append(c,text);panels[0].append(l);fields.push({a,c});}
    panels[0].append(make('p','Facebook et Instagram : publication directe ou programmée. TikTok : brouillon à terminer sur votre téléphone.','ov-pub-note'));
    const data=campaign.campaign_data||{},media=make('select');const choices=[];if(data.videoUrl)choices.push(['video','Vidéo finale']);(data.generatedImages||[]).forEach((src,i)=>{if(/^data:image\/(png|jpeg|webp);base64,/i.test(src))choices.push(['image:'+i,'Image '+(i+1)]);});choices.push(['text','Texte uniquement · Facebook']);for(const [value,text] of choices){const o=make('option',text);o.value=value;media.append(o);}
    const field=(parent,title,input)=>{const l=make('label');l.append(make('span',title),input);parent.append(l);return l;};field(panels[1],'Contenu',media);const previewBox=make('div');panels[1].append(previewBox);
    const caption=make('textarea');caption.rows=4;caption.maxLength=2200;field(panels[1],'Texte de publication',caption);const tags=make('textarea');tags.rows=2;field(panels[1],'Hashtags',tags);const captionNote=make('p','','ov-pub-note');panels[1].append(captionNote);
    const savedScenario = String(data.scenario || campaign.scenario || "")
  .replace(/\*\*/g, "")
  .replace(/^#{1,6}[ \t]+/gm, "")
  .trim();

const sectionHeadings =
  "TITRE|OBJECTIF|PUBLIC CIBLE|ACCROCHE|TEXTE PUBLICATION|" +
  "HASHTAGS|SC[ÈE]NE\\s*[1-4]|NARRATION|" +
  "APPEL À L['’]ACTION|PROMPT VISUEL|STYLE";

function savedSection(heading) {
  const pattern = new RegExp(
    "(?:^|\\n)\\s*" + heading +
    "\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:" +
    sectionHeadings + ")\\s*:?|$)",
    "i"
  );
  return savedScenario.match(pattern)?.[1]?.trim() || "";
}

caption.value = savedSection("TEXTE PUBLICATION");
tags.value = savedSection("HASHTAGS");
   if (data.publicationDraft) {
  if (typeof data.publicationDraft.caption === "string") {
    caption.value = data.publicationDraft.caption;
  }
  if (typeof data.publicationDraft.hashtags === "string") {
    tags.value = data.publicationDraft.hashtags;
  }
}

const saveDraft = make(
  "button", "Enregistrer le texte", "vr-button"
);
saveDraft.type = "button";

const draftStatus = make("p", "", "ov-pub-note");
draftStatus.setAttribute("role", "status");
panels[1].append(saveDraft, draftStatus);

saveDraft.onclick = async () => {
  saveDraft.disabled = true;
  draftStatus.textContent = "Enregistrement…";

  const snapshot = {
    caption: caption.value,
    hashtags: tags.value
  };

  try {
    const response = await fetch(
      "/api/campaigns/" +
      encodeURIComponent(campaign.id) +
      "/publication",
      {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot)
      }
    );

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Enregistrement impossible.");
    }

    data.publicationDraft = result.publicationDraft;

    draftStatus.textContent =
      caption.value === snapshot.caption &&
      tags.value === snapshot.hashtags
        ? "Texte enregistré dans votre compte."
        : "Version enregistrée. Enregistrez vos nouvelles modifications.";
  } catch (error) {
    draftStatus.textContent = error.message;
  } finally {
    saveDraft.disabled = false;
  }
}; const when=make('select');for(const [value,text] of [['now','Maintenant'],['later','Programmer Facebook et Instagram']]){const o=make('option',text);o.value=value;when.append(o);}const whenField=field(panels[1],'Quand publier ?',when);const date=make('input');date.type='datetime-local';const dateField=field(panels[1],'Date et heure locales',date);dateField.hidden=true;when.onchange=()=>{dateField.hidden=when.value!=='later';};
    const recap=make('div');panels[2].append(recap);const agree=make('input');agree.type='checkbox';const consent=make('label','','ov-pub-consent');consent.append(agree,make('span','J’ai vérifié le contenu et les comptes. J’autorise la publication Facebook / Instagram et l’envoi du brouillon TikTok sélectionnés.'));panels[2].append(consent);
    const statusList=make('div');statusList.setAttribute('aria-live','polite');panels[3].append(statusList,make('p','Vous pouvez fermer cette fenêtre et retrouver les résultats dans Paramètres → Mes réseaux.','ov-pub-note'));
    const foot=make('footer');const back=action('Retour',()=>go(step-1));const next=action('Continuer',()=>advance());next.classList.add('ov-pub-primary');const send=make('button','Confirmer et envoyer','vr-button ov-pub-primary');send.type='submit';const done=action('Fermer',()=>d.close());foot.append(back,next,send,done);form.append(foot);let step=0;
    const selected=()=>fields.filter(x=>x.c.checked).map(x=>x.a);const text=()=>[caption.value.trim(),tags.value.trim()].filter(Boolean).join('\n\n');
    function go(i){step=i;panels.forEach((p,k)=>p.hidden=k!==i);stepItems.forEach((n,k)=>{if(k===i)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');});back.hidden=i===0||i===3;next.hidden=i>=2;send.hidden=i!==2;done.hidden=i!==3;panels[i].querySelector('h3').focus();}
    function preview(){previewBox.replaceChildren();const [kind,index]=media.value.split(':');if(kind==='video'){const u=new URL(data.videoUrl,location.origin);if(u.origin!==location.origin||!/^\/videos\/vira-[a-zA-Z0-9_-]+\.mp4$/.test(u.pathname)){message.textContent='Vidéo enregistrée indisponible.';return;}const v=make('video');v.src=u.href;v.controls=true;v.preload='metadata';v.setAttribute('playsinline','');previewBox.append(v);}else if(kind==='image'){const img=make('img');img.src=data.generatedImages[Number(index)];img.alt='Aperçu du contenu sélectionné';previewBox.append(img);}}
    media.onchange=()=>{agree.checked=false;preview();};caption.oninput=tags.oninput=()=>{agree.checked=false;};
    function validate(){const list=selected();if(!list.length)return 'Sélectionnez au moins un compte.';const kind=media.value.split(':')[0];if(kind==='video'){try{const u=new URL(data.videoUrl,location.origin);if(u.origin!==location.origin||!/^\/videos\/vira-[a-zA-Z0-9_-]+\.mp4$/.test(u.pathname))return 'Vidéo enregistrée indisponible.';}catch{return 'Vidéo enregistrée indisponible.';}}if(list.some(a=>a.platform==='tiktok')&&kind!=='video')return 'TikTok nécessite une vidéo finale. Choisissez une vidéo ou retirez TikTok.';if(list.some(a=>a.platform==='instagram')&&kind==='text')return 'Instagram nécessite une image ou une vidéo.';if(kind==='text'&&!text())return 'Ajoutez le texte de publication.';const limit=list.some(a=>a.platform==='instagram')?2200:5000;if(text().length>limit)return 'Le texte et les hashtags dépassent '+limit+' caractères.';if(when.value==='later'){if(list.some(a=>a.platform==='tiktok'))return 'La programmation concerne Facebook et Instagram. Retirez TikTok ou choisissez Maintenant.';if(!date.value||!Number.isFinite(new Date(date.value).getTime())||new Date(date.value)<=new Date())return 'Choisissez une date et une heure futures.';}return '';}
    function advance(){message.textContent='';if(step===0){if(!selected().length){message.textContent='Sélectionnez au moins un compte.';return;}whenField.hidden=selected().every(a=>a.platform==='tiktok');if(whenField.hidden){when.value='now';dateField.hidden=true;}captionNote.textContent=selected().some(a=>a.platform==='tiktok')?'Pour TikTok, copiez ce texte et collez-le lors de la publication sur votre téléphone. Il sera envoyé directement avec la publication Facebook / Instagram.':'Le texte et les hashtags seront envoyés avec votre publication.';preview();go(1);}else{const error=validate();if(error){message.textContent=error;return;}recap.replaceChildren();for(const a of selected())recap.append(make('p',names[a.platform]+' · '+a.display_name+' — '+(a.platform==='tiktok'?'brouillon à terminer sur téléphone':when.value==='later'?'publication le '+new Date(date.value).toLocaleString('fr-CA'):'publication immédiate')));recap.append(make('p',text()||'Sans texte de publication','ov-pub-note'));agree.checked=false;go(2);}}
    const jobs=[];function show(j,status,error=''){j.status=status;j.box.dataset.state=status;j.box.replaceChildren(make('strong',names[j.a.platform]+' · '+j.a.display_name),make('p',labels[status]||status));if(error)j.box.append(make('p',error));if(status==='inbox')j.box.append(make('p','Ouvrez TikTok → Boîte de réception sur votre téléphone pour terminer la publication.'));if(j.a.platform==='tiktok'&&text()&&(status==='inbox'||status==='published'))j.box.append(action('Copier le texte et les hashtags',async()=>{try{await navigator.clipboard.writeText(text());j.box.append(make('p','Texte copié. Collez-le dans TikTok.'));}catch{j.box.append(make('p','La copie est indisponible. Sélectionnez le texte dans le récapitulatif.'));}}));}
    form.onsubmit=async e=>{e.preventDefault();if(sending||step!==2)return;const error=validate();if(error){message.textContent=error;return;}if(!agree.checked){message.textContent='Cochez la confirmation après avoir vérifié votre contenu.';agree.focus();return;}sending=true;message.textContent='';previewBox.querySelector('video')?.pause();go(3);const chosen=selected();for(const input of form.querySelectorAll('input,select,textarea'))input.disabled=true;
      for(const a of chosen){const j={a,box:make('div','','ov-pub-result'),requestId:crypto.randomUUID()};jobs.push(j);statusList.append(j.box);show(j,'queued');}
      for(const j of jobs){try{const [kind,index]=media.value.split(':');const payload=j.a.platform==='tiktok'?{campaignId:campaign.id,accountId:j.a.id,requestId:j.requestId,confirm:true}:{campaignId:String(campaign.id),accountId:String(j.a.id),kind,imageIndex:Number(index||0),caption:text(),scheduledAt:when.value==='later'?new Date(date.value).toISOString():null,requestId:j.requestId};const r=await api(j.a.network,j.a.platform==='tiktok'?'uploads':'posts',{method:'POST',headers,body:JSON.stringify(payload)});j.id=(r.upload||r.post).id;j.scheduled=when.value==='later'&&j.a.platform!=='tiktok';show(j,(r.upload||r.post).status,(r.upload||r.post).error);if(j.scheduled)j.box.append(make('p','Publication programmée. Retrouvez son suivi dans Paramètres.'));}catch(err){show(j,'uncertain',err.message+' Vérifiez l’historique avant de renvoyer.');}}
      let busy=false;const started=Date.now();timer=setInterval(async()=>{if(!d.isConnected||Date.now()-started>10*60*1000){clearInterval(timer);return;}if(busy)return;busy=true;try{const pending=jobs.filter(j=>j.id&&!j.scheduled&&!['published','inbox','failed','cancelled'].includes(j.status));if(!pending.length){clearInterval(timer);return;}let meta=null;if(pending.some(j=>j.a.network==='meta')){try{meta=await api('meta','posts');}catch{for(const j of pending.filter(j=>j.a.network==='meta'))show(j,'uncertain','Suivi Meta indisponible. Vérifiez les résultats dans Paramètres.');}}for(const j of pending){if(j.a.network==='meta'&&!meta)continue;try{const r=j.a.network==='tiktok'?(await api('tiktok','uploads/'+j.id)).upload:meta.posts.find(p=>p.id===j.id);if(r)show(j,r.status,r.error);}catch{show(j,'uncertain','Suivi indisponible. Vérifiez les résultats dans Paramètres.');}}}catch{for(const j of jobs.filter(j=>j.a.network==='meta'&&j.id&&!['published','failed','cancelled'].includes(j.status)))show(j,'uncertain','Suivi indisponible. Vérifiez les résultats dans Paramètres.');}finally{busy=false;}},5000);
    };
    go(0);
  };
})();

(() => {
  'use strict';
  const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
  const titles={facebook:'Facebook',instagram:'Instagram',tiktok:'TikTok'};
  const labels={queued:'En attente',processing:'Traitement en cours',uploading:'Transfert en cours',waiting:'Préparation par le réseau',published:'Publication confirmée',inbox:'Brouillon TikTok reçu',failed:'Échec',uncertain:'Résultat à vérifier',cancelled:'Annulé'};
  const style=el('style');style.textContent='.ov-history{grid-column:1/-1}.ov-history-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.ov-history-filters{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.ov-history-filters label{display:grid;gap:6px;flex:1 1 160px;font-size:14px}.ov-history-filters input,.ov-history-filters select{padding:12px;border:1px solid #bac4d2;border-radius:9px;font:inherit;width:100%;box-sizing:border-box;background:white;color:#253047}.ov-history-card{border:1px solid #e1e5ed;border-radius:12px;padding:16px;margin:12px 0;overflow-wrap:anywhere}.ov-history-card h3{margin:0 0 8px;font-size:17px}.ov-history-card p{margin:8px 0}.ov-history-badge{display:inline-block;padding:5px 10px;border-radius:8px;background:#eee7ff;color:#6339a6;font-size:13px}.ov-history-card[data-status=published] .ov-history-badge,.ov-history-card[data-status=inbox] .ov-history-badge{background:#e5f5eb;color:#236a42}.ov-history-card[data-status=failed] .ov-history-badge,.ov-history-card[data-status=uncertain] .ov-history-badge{background:#fff1df;color:#915515}.ov-history-note{font-size:14px;color:#58677f}';document.head.append(style);
  async function list(network,path){const r=await fetch('/api/social/'+network+'/'+path,{credentials:'same-origin'});const d=await r.json();if(!r.ok)throw Error(d.error||'Historique indisponible.');return d;}
  function mount(grid){
    const section=el('section','','vr-panel ov-history');const header=el('div','','ov-history-header');const refresh=el('button','Actualiser','vr-button');refresh.type='button';header.append(el('h2','Historique des publications'),refresh);section.append(header,el('p','Retrouvez les résultats de vos envois. Vérifiez cet historique avant de renvoyer un contenu.','ov-history-note'));
    const message=el('p');message.setAttribute('role','status');section.append(message);const filters=el('div','','ov-history-filters');const search=el('input');search.type='search';const network=el('select');const state=el('select');
    const field=(title,input)=>{const label=el('label',title);label.append(input);filters.append(label);};field('Rechercher une campagne',search);field('Réseau',network);field('Résultat',state);
    for(const [value,text] of [['all','Tous les réseaux'],...Object.entries(titles)]){const o=el('option',text);o.value=value;network.append(o);}for(const [value,text] of [['all','Tous les résultats'],['published','Publications confirmées'],['inbox','Brouillons TikTok reçus'],['active','En cours'],['attention','À vérifier / échecs'],['cancelled','Annulés']]){const o=el('option',text);o.value=value;state.append(o);}section.append(filters);const count=el('p','','ov-history-note');const cards=el('div');const more=el('button','Afficher davantage','vr-button');more.type='button';section.append(count,cards,more);grid.append(section);let rows=[],limit=20;
    function render(){if(!section.isConnected)return;const q=search.value.trim().toLocaleLowerCase();const selected=rows.filter(r=>(network.value==='all'||network.value===r.platform)&&(!q||(r.title+' '+r.name).toLocaleLowerCase().includes(q))&&(state.value==='all'||state.value===r.status||state.value==='active'&&['queued','processing','uploading','waiting'].includes(r.status)||state.value==='attention'&&['failed','uncertain'].includes(r.status)));cards.replaceChildren();count.textContent=selected.length+' résultat(s) dans les derniers envois disponibles';more.hidden=selected.length<=limit;
      if(!selected.length)cards.append(el('p',rows.length?'Aucun résultat pour ces filtres.':'Aucune publication enregistrée.'));
      for(const r of selected.slice(0,limit)){const card=el('article','','ov-history-card');card.dataset.status=r.status;card.append(el('h3',r.title),el('p',titles[r.platform]+' · '+r.name),el('span',labels[r.status]||r.status,'ov-history-badge'));const date=new Date(r.at);if(Number.isFinite(date.getTime()))card.append(el('p','Demande du '+date.toLocaleString('fr-CA'),'ov-history-note'));if(r.scheduled&&new Date(r.scheduled)>new Date())card.append(el('p','Prévue le '+new Date(r.scheduled).toLocaleString('fr-CA'),'ov-history-note'));if(r.error)card.append(el('p',r.error));
        if(r.platform!=='tiktok'&&r.status==='published'&&r.remoteId){const a=el('a','Voir la publication','vr-button');a.href='/api/social/meta/posts/'+encodeURIComponent(r.id)+'/view';a.target='_blank';a.rel='noopener noreferrer';card.append(a);}else if(r.platform==='tiktok')card.append(el('p',r.status==='inbox'?'Terminez la publication depuis la boîte de réception TikTok sur votre téléphone.':r.status==='published'?'Publication terminée dans TikTok. Le lien public n’est pas disponible dans cet historique.':'Le statut concerne le transfert du brouillon TikTok.','ov-history-note'));cards.append(card);}
    }
    for(const input of [search,network,state])input.addEventListener(input===search?'input':'change',()=>{limit=20;render();});more.onclick=()=>{limit+=20;render();};
    async function load(){refresh.disabled=true;message.textContent='Chargement de l’historique…';try{const result=await Promise.allSettled([list('meta','posts'),list('tiktok','uploads')]);if(!section.isConnected)return;rows=[];const errors=[];result.forEach((r,i)=>{if(r.status==='rejected'){errors.push((i?'TikTok':'Facebook / Instagram')+' : '+r.reason.message);return;}for(const p of (i?r.value.uploads:r.value.posts)||[]){rows.push({id:p.id,platform:i?'tiktok':p.platform,title:(i?p.campaignTitle:p.campaign_title)||'Campagne supprimée ou sans titre',name:(i?p.displayName:p.display_name)||'Compte TikTok',status:p.status,at:i?p.createdAt:p.created_at,scheduled:i?null:p.scheduled_at,error:p.error,remoteId:p.remote_id});}});rows.sort((a,b)=>(new Date(b.at).getTime()||0)-(new Date(a.at).getTime()||0));message.textContent=errors.join(' · ');render();}catch{message.textContent='Impossible de charger l’historique. Réessayez.';}finally{refresh.disabled=false;}}
    refresh.onclick=load;load();
  }
  function observe(){const grid=document.querySelector('.vr-settings-grid');if(grid&&!grid.querySelector('.ov-history'))mount(grid);}
  new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});observe();
})();
