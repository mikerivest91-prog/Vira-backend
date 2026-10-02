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
      section.append(el('p','L’envoi de vidéos TikTok sera activé après la vérification de la connexion.'));
    }catch(e){message.textContent=e.message;}}
    await refresh();
  }
  function observe(){const grid=document.querySelector('.vr-settings-grid');if(grid&&!grid.querySelector('.ov-tiktok-panel'))render(grid);}
  new MutationObserver(observe).observe(document.body,{childList:true,subtree:true});observe();
  const result=location.hash.match(/^#tiktok=(connected|invalid|cancelled|permissions|failed)$/);if(result){history.replaceState(null,'',location.pathname+location.search);const messages={connected:'Compte TikTok connecté. Retrouvez-le dans Paramètres.',invalid:'Connexion expirée. Recommencez depuis Olyvex.',cancelled:'Connexion TikTok annulée.',permissions:'Autorisez l’accès au profil TikTok.',failed:'Connexion TikTok impossible. Vérifiez les identifiants, les permissions et le compte de test.'};const d=el('dialog');d.className='vr-lightbox ov-social-dialog';d.append(el('p',messages[result[1]]),button('Fermer',()=>d.close()));document.body.append(d);d.addEventListener('close',()=>d.remove(),{once:true});d.showModal();}
})();
