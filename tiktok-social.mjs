import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {seal,unseal} from './meta-social.mjs';

export function tiktokConfiguration(env) {
  let origin='';try {const u=new URL(env.APP_ORIGIN);if(u.protocol==='https:'&&u.pathname==='/'&&!u.username&&!u.password)origin=u.origin;}catch{}
  const key=/^[a-f0-9]{64}$/i.test(env.SOCIAL_TOKEN_KEY||'')?Buffer.from(env.SOCIAL_TOKEN_KEY,'hex'):null;
  const client=String(env.TIKTOK_CLIENT_KEY||'').trim(),secret=String(env.TIKTOK_CLIENT_SECRET||'').trim();
  return {origin,key,client,secret,callback:origin+'/api/social/tiktok/callback',ready:Boolean(origin&&key&&client&&secret)};
}
export function installTikTokSocial({app,pool,requireAuth,videoStorage,env=process.env,fetchImpl=fetch}) {
  const cfg=tiktokConfiguration(env),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const permitted=u=>env.SOCIAL_ENABLE_CLIENTS==='true'||Boolean(env.SOCIAL_TEST_EMAIL||env.ADMIN_EMAIL)&&String(u.email).toLowerCase()===String(env.SOCIAL_TEST_EMAIL||env.ADMIN_EMAIL).trim().toLowerCase();
  const allowed=(req,res,next)=>permitted(req.user)?next():res.status(403).json({error:'TikTok est en test privé.'});
  const mutation=(req,res,next)=>req.get('origin')===cfg.origin&&req.get('x-olyvex-request')==='1'?next():res.status(403).json({error:'Requête non autorisée.'});
  const handler=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch{res.status(503).json({error:'TikTok est indisponible. Réessayez ou reconnectez votre compte.'});}};
  const safeCodes=new Set(['upload_url_missing','upload_url_invalid','upload_host_refused','upload_protocol_refused','upload_credentials_refused','ENOENT','EACCES','EISDIR','invalid_param','spam_risk_too_many_pending_share','spam_risk_user_banned_from_posting','invalid_publish_id','token_not_authorized_for_specified_publish_id','TimeoutError','AbortError','TypeError','invalid_client','invalid_grant','invalid_request','invalid_scope','access_denied','access_token_invalid','scope_not_authorized','rate_limit_exceeded','internal_error','ok','42P01','23502','23503','22P02','42883','42703','42501']);
  const safeCode=value=>safeCodes.has(value)?value:'unclassified';
  async function oauth(endpoint,params) {
    const r=await fetchImpl('https://open.tiktokapis.com/v2/oauth/'+endpoint+'/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_key:cfg.client,client_secret:cfg.secret,...params}),redirect:'error',signal:AbortSignal.timeout(20000)});
    const data=await r.json();if(!r.ok||data.error){const error=Error('TikTok OAuth failed');error.providerCode=safeCode(typeof data.error==='string'?data.error:data.error?.code);error.httpStatus=r.status;throw error;}return data;
  }
  function validateToken(data) {if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||typeof data.open_id!=='string'||!data.open_id||!Number.isFinite(data.expires_in)||data.expires_in<=0||!Number.isFinite(data.refresh_expires_in)||data.refresh_expires_in<=0)throw Error('Invalid token');}
  async function storeToken(userId,data,name) {
    validateToken(data);
    await pool.query(`INSERT INTO olyvex_tiktok_accounts(user_id,remote_id,display_name,token_cipher,refresh_cipher,permissions,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,$6,NOW()+($7*INTERVAL '1 second'),NOW()+($8*INTERVAL '1 second')) ON CONFLICT(user_id,remote_id) DO UPDATE SET display_name=COALESCE($3,olyvex_tiktok_accounts.display_name),token_cipher=EXCLUDED.token_cipher,refresh_cipher=EXCLUDED.refresh_cipher,permissions=EXCLUDED.permissions,expires_at=EXCLUDED.expires_at,refresh_expires_at=EXCLUDED.refresh_expires_at`,[userId,data.open_id,name||null,seal(data.access_token,cfg.key),seal(data.refresh_token,cfg.key),JSON.stringify(String(data.scope||'').split(',')),Math.min(data.expires_in,86400),Math.min(data.refresh_expires_in,31536000)]);
  }
  app.get('/api/social/tiktok/status',requireAuth,handler(async(req,res)=>res.json({configured:cfg.ready,available:cfg.ready&&permitted(req.user)})));
  app.get('/api/social/tiktok/accounts',requireAuth,allowed,handler(async(req,res)=>{const r=await pool.query('SELECT id,display_name,expires_at FROM olyvex_tiktok_accounts WHERE user_id=$1 ORDER BY id',[req.user.id]);res.json({accounts:r.rows});}));
  app.post('/api/social/tiktok/connect',requireAuth,allowed,mutation,handler(async(req,res)=>{
    if(!cfg.ready)return res.status(503).json({error:'Ajoutez les identifiants TikTok sur Render.'});
    const state=crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM olyvex_tiktok_states WHERE user_id=$1 OR expires_at<NOW()',[req.user.id]);
    await pool.query("INSERT INTO olyvex_tiktok_states(state_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[hash(state),req.user.id]);
    const url=new URL('https://www.tiktok.com/v2/auth/authorize/');url.search=new URLSearchParams({client_key:cfg.client,response_type:'code',scope:'user.info.basic,video.upload',redirect_uri:cfg.callback,state,disable_auto_auth:'1'}).toString();res.json({url:url.href});
  }));
  app.get('/api/social/tiktok/callback',requireAuth,allowed,async(req,res)=>{
    res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');const back=s=>res.redirect('/#tiktok='+s);
    let stage='state';
    try{
      if(!cfg.ready||!/^[a-f0-9]{64}$/.test(req.query.state||''))return back('invalid');
      const state=await pool.query('DELETE FROM olyvex_tiktok_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>NOW() RETURNING user_id',[hash(req.query.state),req.user.id]);
      if(!state.rowCount)return back('invalid');if(req.query.error)return back('cancelled');if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>4096)return back('invalid');
      stage='token';const data=await oauth('token',{grant_type:'authorization_code',code:req.query.code,redirect_uri:cfg.callback});stage='token-validation';validateToken(data);
      if(!String(data.scope||'').split(',').includes('user.info.basic'))return back('permissions');
      stage='profile';const r=await fetchImpl('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',{headers:{Authorization:'Bearer '+data.access_token},redirect:'error',signal:AbortSignal.timeout(20000)});const profile=await r.json();
      if(!r.ok||profile.error?.code!=='ok'||profile.data?.user?.open_id!==data.open_id||typeof profile.data.user.display_name!=='string'){const error=Error('Profile unavailable');error.providerCode=safeCode(profile.error?.code);error.httpStatus=r.status;throw error;}
      stage='database';await storeToken(req.user.id,data,profile.data.user.display_name);return back('connected');
    }catch(error){console.warn('[Olyvex TikTok diagnostic]',JSON.stringify({version:'connexion-2',stage,code:safeCode(error.providerCode||error.code),...(Number.isInteger(error.httpStatus)?{httpStatus:error.httpStatus}:{})}));return back('failed');}
  });
  app.delete('/api/social/tiktok/accounts/:id',requireAuth,allowed,mutation,handler(async(req,res)=>{
    if(!/^[1-9][0-9]{0,19}$/.test(req.params.id))return res.status(400).json({error:'Compte invalide.'});
    const r=await pool.query('SELECT * FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Compte introuvable.'});
    await oauth('revoke',{token:unseal(r.rows[0].token_cipher,cfg.key)});
    await pool.query('DELETE FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({ok:true});
  }));
  const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const numberId=s=>/^[1-9][0-9]{0,19}$/.test(String(s));
  async function ownedVideo(filename,userId){
    if(!videoStorage||!/^vira-[a-zA-Z0-9_-]+\.mp4$/.test(filename))throw Error('Invalid video');
    const owner=JSON.parse(await fs.readFile(path.join(videoStorage,filename+'.owner.json'),'utf8'));if(String(owner.userId)!==String(userId))throw Error('Video owner mismatch');
    const stat=await fs.stat(path.join(videoStorage,filename));if(!stat.isFile()||stat.size<1||stat.size>64*1024*1024)throw Error('Video size unsupported');return stat.size;
  }
  const publicJob=j=>({id:j.id,status:j.status,uploadedBytes:Number(j.uploaded_bytes||0),totalBytes:Number(j.total_bytes||0),error:j.error||null});
  app.post('/api/social/tiktok/uploads',requireAuth,allowed,mutation,handler(async(req,res)=>{
    const b=req.body||{};if(!cfg.ready||!numberId(b.accountId)||!numberId(b.campaignId)||!uuid(b.requestId)||b.confirm!==true)return res.status(400).json({error:'Confirmez le compte et la vidéo à envoyer.'});
    const prior=await pool.query('SELECT * FROM olyvex_tiktok_uploads WHERE user_id=$1 AND request_id=$2',[req.user.id,b.requestId]);if(prior.rowCount)return res.json({upload:publicJob(prior.rows[0])});
    const account=await pool.query('SELECT * FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[b.accountId,req.user.id]);
    const campaign=await pool.query('SELECT * FROM vira_campaigns WHERE id=$1 AND user_id=$2',[b.campaignId,req.user.id]);
    if(!account.rowCount||!campaign.rowCount)return res.status(404).json({error:'Compte ou campagne introuvable.'});
    if(!account.rows[0].permissions.includes('video.upload'))return res.status(400).json({error:'Reconnectez TikTok et autorisez l’envoi de vidéos.'});
    if(new Date(account.rows[0].expires_at)<=new Date(Date.now()+60000))return res.status(400).json({error:'Reconnectez TikTok avant cet envoi.'});
    let filename,size;try{const u=new URL(campaign.rows[0].campaign_data?.videoUrl||'',cfg.origin);if(u.origin!==cfg.origin||u.search||u.hash||!/^\/videos\/vira-[a-zA-Z0-9_-]+\.mp4$/.test(u.pathname))throw Error();filename=u.pathname.split('/').pop();size=await ownedVideo(filename,req.user.id);}catch{return res.status(400).json({error:'Choisissez une vidéo enregistrée dans votre campagne, de 64 Mo maximum.'});}
    const count=await pool.query("SELECT COUNT(*) AS n FROM olyvex_tiktok_uploads WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",[req.user.id]);if(Number(count.rows[0].n)>=5)return res.status(429).json({error:'Limite de 5 envois par heure atteinte. Terminez les brouillons dans TikTok.'});
    const inserted=await pool.query("INSERT INTO olyvex_tiktok_uploads(id,user_id,account_id,campaign_id,request_id,filename,total_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING *",[crypto.randomUUID(),req.user.id,b.accountId,b.campaignId,b.requestId,filename,size]);
    const row=inserted.rows[0]||(await pool.query('SELECT * FROM olyvex_tiktok_uploads WHERE user_id=$1 AND request_id=$2',[req.user.id,b.requestId])).rows[0];res.status(202).json({upload:publicJob(row)});
  }));
  app.get('/api/social/tiktok/uploads/:id',requireAuth,allowed,handler(async(req,res)=>{if(!uuid(req.params.id))return res.sendStatus(404);const r=await pool.query('SELECT * FROM olyvex_tiktok_uploads WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Envoi introuvable.'});res.json({upload:publicJob(r.rows[0])});}));
  app.get('/api/social/tiktok/uploads',requireAuth,allowed,handler(async(req,res)=>{const r=await pool.query('SELECT * FROM olyvex_tiktok_uploads WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',[req.user.id]);res.json({uploads:r.rows.map(publicJob)});}));
  async function posting(endpoint,token,body){const r=await fetchImpl('https://open.tiktokapis.com/v2/post/publish/'+endpoint+'/',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||data.error?.code!=='ok'){const e=Error('TikTok refused');e.refused=Boolean(data.error?.code&&data.error.code!=='ok');e.providerCode=safeCode(data.error?.code);e.httpStatus=r.status;throw e;}return data.data;}
  let timer,uploadTimer,busy=false;
  async function tick(){
    if(!cfg.ready||busy)return;busy=true;
    try{
      await pool.query("UPDATE olyvex_tiktok_uploads SET status='uncertain',error='Envoi interrompu. Vérifiez votre boîte de réception TikTok avant de renvoyer.' WHERE status='uploading' AND updated_at<NOW()-INTERVAL '10 minutes'");
      const jobs=await pool.query("UPDATE olyvex_tiktok_uploads SET status='uploading',updated_at=NOW() WHERE id=(SELECT id FROM olyvex_tiktok_uploads WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *");
      for(const job of jobs.rows){let dispatched=false,stage='validation',uploadHost;try{
        const a=await pool.query('SELECT * FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[job.account_id,job.user_id]);const account=a.rows[0];if(!account||new Date(account.expires_at)<=new Date()||!account.permissions.includes('video.upload'))throw Error('Account unavailable');
        const size=await ownedVideo(job.filename,job.user_id);if(size!==Number(job.total_bytes))throw Error('Video changed');
        const token=unseal(account.token_cipher,cfg.key);stage='initialisation';dispatched=true;
        const data=await posting('inbox/video/init',token,{source_info:{source:'FILE_UPLOAD',video_size:size,chunk_size:size,total_chunk_count:1}});
        if(typeof data.publish_id!=='string'||!data.publish_id||data.publish_id.length>64)throw Error('Invalid publish ID');
        await pool.query('UPDATE olyvex_tiktok_uploads SET publish_id=$2,updated_at=NOW() WHERE id=$1',[job.id,data.publish_id]);
        stage='adresse_transfert';
        const fail=code=>{const e=Error(code);e.code=code;throw e;};
        if(typeof data.upload_url!=='string'||!data.upload_url)fail('upload_url_missing');
        let upload;try{upload=new URL(data.upload_url);}catch{fail('upload_url_invalid');}
        uploadHost=upload.hostname;
        if(upload.protocol!=='https:'||upload.port)fail('upload_protocol_refused');
        if(upload.username||upload.password)fail('upload_credentials_refused');
        if(!/^(?:open-upload|upload)(?:[.-][a-z0-9-]+)*\.tiktokapis\.com$/i.test(upload.hostname))fail('upload_host_refused');
        stage='lecture_video';
        const bytes=await fs.readFile(path.join(videoStorage,job.filename));
        stage='transfert_video';const r=await fetchImpl(upload.href,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(size),'Content-Range':`bytes 0-${size-1}/${size}`},body:bytes,redirect:'error',signal:AbortSignal.timeout(240000)});
        if(r.status!==201){const e=Error('Transfer incomplete');e.httpStatus=r.status;throw e;}
        await pool.query("UPDATE olyvex_tiktok_uploads SET status='processing',uploaded_bytes=total_bytes,updated_at=NOW() WHERE id=$1",[job.id]);
      }catch(e){console.warn('[Olyvex TikTok envoi]',JSON.stringify({version:'transfert-3',stage,...(uploadHost?{uploadHost}:{}),code:safeCode(e.providerCode||e.code||e.name),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{})}));await pool.query('UPDATE olyvex_tiktok_uploads SET status=$2,error=$3,updated_at=NOW() WHERE id=$1',[job.id,dispatched&&!e.refused?'uncertain':'failed',dispatched&&!e.refused?'Le transfert n’a pas été confirmé. Olyvex vérifie son résultat sans renvoyer la vidéo.':'Envoi refusé ou vidéo indisponible ('+safeCode(e.providerCode||e.code)+'). Vérifiez les permissions et les limites TikTok.']);}}
      const pending=await pool.query("UPDATE olyvex_tiktok_uploads SET checked_at=NOW() WHERE id IN (SELECT id FROM olyvex_tiktok_uploads WHERE (status='processing' OR (status='uncertain' AND publish_id IS NOT NULL AND created_at>NOW()-INTERVAL '24 hours')) AND (checked_at IS NULL OR checked_at<NOW()-INTERVAL '1 minute') ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *");
      for(const job of pending.rows){try{const a=await pool.query('SELECT * FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[job.account_id,job.user_id]);if(!a.rows[0])continue;const data=await posting('status/fetch',unseal(a.rows[0].token_cipher,cfg.key),{publish_id:job.publish_id});
        const status={SEND_TO_USER_INBOX:'inbox',PUBLISH_COMPLETE:'published',FAILED:'failed'}[data.status];if(status)await pool.query('UPDATE olyvex_tiktok_uploads SET status=$2,error=$3,updated_at=NOW() WHERE id=$1',[job.id,status,status==='failed'?'TikTok a refusé le traitement. Vérifiez le format, la durée et les limites du compte.':null]);
      }catch(e){console.warn('[Olyvex TikTok suivi]',JSON.stringify({code:safeCode(e.providerCode||e.code||e.name),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{})}));/* Status lookup never initiates another upload. */}}
      await pool.query("UPDATE olyvex_tiktok_uploads SET status='uncertain',error='Le suivi TikTok prend trop de temps. Vérifiez votre boîte de réception avant de renvoyer.' WHERE status='processing' AND created_at<NOW()-INTERVAL '1 hour'");
    }finally{busy=false;}
  }
  async function refresh() {
    if(!cfg.ready)return;
    // Database leases prevent simultaneous refresh-token rotation across instances.
    const r=await pool.query("UPDATE olyvex_tiktok_accounts SET refresh_claimed_at=NOW() WHERE id IN (SELECT id FROM olyvex_tiktok_accounts WHERE expires_at<NOW()+INTERVAL '10 minutes' AND refresh_expires_at>NOW() AND (refresh_claimed_at IS NULL OR refresh_claimed_at<NOW()-INTERVAL '5 minutes') ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *");
    for(const account of r.rows){try{const data=await oauth('token',{grant_type:'refresh_token',refresh_token:unseal(account.refresh_cipher,cfg.key)});if(data.open_id!==account.remote_id)throw Error('Identity mismatch');await storeToken(account.user_id,data,account.display_name);await pool.query('UPDATE olyvex_tiktok_accounts SET refresh_claimed_at=NULL WHERE id=$1',[account.id]);}catch{/* Retry after lease expiry; never log credentials. */}}
  }
  return {async init(){await pool.query(`CREATE TABLE IF NOT EXISTS olyvex_tiktok_states(state_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS olyvex_tiktok_accounts(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,remote_id TEXT NOT NULL,display_name TEXT NOT NULL,token_cipher TEXT NOT NULL,refresh_cipher TEXT NOT NULL,permissions JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,refresh_expires_at TIMESTAMPTZ NOT NULL,refresh_claimed_at TIMESTAMPTZ,UNIQUE(user_id,remote_id));
    CREATE TABLE IF NOT EXISTS olyvex_tiktok_uploads(id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,account_id BIGINT NOT NULL REFERENCES olyvex_tiktok_accounts(id) ON DELETE CASCADE,campaign_id BIGINT REFERENCES vira_campaigns(id) ON DELETE SET NULL,request_id UUID NOT NULL,filename TEXT NOT NULL,total_bytes BIGINT NOT NULL,uploaded_bytes BIGINT NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','uploading','processing','inbox','published','failed','uncertain')),publish_id TEXT,error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),checked_at TIMESTAMPTZ,UNIQUE(user_id,request_id));`);timer=setInterval(()=>refresh().catch(()=>{}),60000);timer.unref?.();uploadTimer=setInterval(()=>tick().catch(()=>{}),15000);uploadTimer.unref?.();},tick,stop(){clearInterval(timer);clearInterval(uploadTimer);}};
}
