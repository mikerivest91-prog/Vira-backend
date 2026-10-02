import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const scopes = ['pages_show_list','pages_read_engagement','pages_manage_posts','instagram_basic','instagram_content_publish','business_management'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
export function canPublishToPage(tasks) {
  return Array.isArray(tasks) && tasks.some(t => ['CREATE_CONTENT','MANAGE','PROFILE_PLUS_CREATE_CONTENT','PROFILE_PLUS_MANAGE','PROFILE_PLUS_FULL_CONTROL'].includes(t));
}
export function seal(value, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
  const body = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
}
export function unseal(value,key) {
  const data=Buffer.from(value,'base64'), decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
  decipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
}
export function configuration(env) {
  let origin='';
  try { const u=new URL(env.APP_ORIGIN || env.FRONTEND_ORIGIN); if(u.protocol==='https:' && !u.username && !u.password && u.pathname==='/') origin=u.origin; } catch {}
  const key=/^[a-fA-F0-9]{64}$/.test(env.SOCIAL_TOKEN_KEY || '')?Buffer.from(env.SOCIAL_TOKEN_KEY,'hex'):null;
  const version=/^v\d+\.0$/.test(env.META_API_VERSION || '')?env.META_API_VERSION:'';
  const appId=id(env.META_APP_ID)?env.META_APP_ID:'';
  const configId=id(env.META_CONFIG_ID)?env.META_CONFIG_ID:'';
  const ready=Boolean(origin && key && version && appId && configId && env.META_APP_SECRET);
  return {origin,key,version,appId,configId,ready,secret:env.META_APP_SECRET,callback:origin+'/api/social/meta/callback'};
}
export function signedMedia(id, expires, key) {
  return crypto.createHmac('sha256',key).update(`${id}:${expires}`).digest('hex');
}
export function validMediaSignature(assetId,expires,signature,key,now=Date.now()) {
  if(!/^[0-9a-f-]{36}$/.test(assetId) || !/^\d{10,13}$/.test(String(expires)) || !/^[a-f0-9]{64}$/.test(signature || '') || Number(expires)<=now || Number(expires)>now+86400000) return false;
  return crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(signedMedia(assetId,expires,key),'hex'));
}
class PublicError extends Error { constructor(message,status=400){super(message);this.status=status;} }

export function installMetaSocial({app,pool,requireAuth,videoStorage,ffmpegPath,env=process.env,fetchImpl=fetch}) {
  const cfg=configuration(env);
  const active=new Set();
  const permitted=user=>env.SOCIAL_ENABLE_CLIENTS==='true' || Boolean(env.SOCIAL_TEST_EMAIL || env.ADMIN_EMAIL) && String(user.email).toLowerCase()===String(env.SOCIAL_TEST_EMAIL || env.ADMIN_EMAIL).trim().toLowerCase();
  const allowed=(req,res,next)=>{if(!permitted(req.user))return res.status(403).json({error:'La publication sociale est en test privé.'});next();};
  const mutation=(req,res,next)=>{if(req.get('origin')!==cfg.origin || req.get('x-olyvex-request')!=='1')return res.status(403).json({error:'Requête non autorisée.'});next();};
  const handler=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){res.status(error instanceof PublicError?error.status:503).json({error:error instanceof PublicError?error.message:'Opération indisponible. Réessayez plus tard.'});}};
  const needsConfig=()=>{if(!cfg.ready)throw new PublicError('La connexion Facebook et Instagram doit être configurée sur le serveur.',503);};
  async function graph(endpoint,token,params={},method='GET',video=false) {
    const u=new URL(`https://${video?'graph-video':'graph'}.facebook.com/${cfg.version}/${endpoint}`);
    const fields=new URLSearchParams(params);
    if(token)fields.set('appsecret_proof',crypto.createHmac('sha256',cfg.secret).update(token).digest('hex'));
    if(method==='GET')u.search=fields.toString();
    const response=await fetchImpl(u,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:fields}:{}),signal:AbortSignal.timeout(60000),redirect:'error'});
    let data;try{data=await response.json();}catch{throw new Error('Meta response unavailable');}
    if(!response.ok || data.error)throw new PublicError(data.error?.code===190?'Connexion Meta expirée. Reconnectez vos comptes.':'Meta a refusé cette opération. Vérifiez les permissions, le format du média et votre compte.',422);
    return data;
  }
  app.get('/api/social/meta/status',requireAuth,handler(async(req,res)=>res.json({configured:cfg.ready,available:cfg.ready&&permitted(req.user),testMode:env.SOCIAL_ENABLE_CLIENTS!=='true'})));
  app.get('/api/social/meta/accounts',requireAuth,allowed,handler(async(req,res)=>{
    const result=await pool.query('SELECT id,platform,display_name,expires_at FROM olyvex_social_accounts WHERE user_id=$1 ORDER BY platform,display_name',[req.user.id]);
    res.json({accounts:result.rows});
  }));
  app.post('/api/social/meta/connect',requireAuth,allowed,mutation,handler(async(req,res)=>{
    needsConfig();const state=crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM olyvex_social_states WHERE user_id=$1 OR expires_at<NOW()',[req.user.id]);
    await pool.query("INSERT INTO olyvex_social_states(state_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",[digest(state),req.user.id]);
    const url=new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
    url.search=new URLSearchParams({client_id:cfg.appId,redirect_uri:cfg.callback,state,config_id:cfg.configId,response_type:'code',override_default_response_type:'true'}).toString();
    res.json({url:url.href});
  }));
  app.get('/api/social/meta/callback',requireAuth,allowed,async(req,res)=>{
    res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
    const back=status=>res.redirect('/#social='+status);
    try {
      needsConfig();if(!/^[a-f0-9]{64}$/.test(req.query.state || ''))return back('invalid');
      const state=await pool.query('DELETE FROM olyvex_social_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>NOW() RETURNING user_id',[digest(req.query.state),req.user.id]);
      if(!state.rowCount)return back('invalid');if(req.query.error)return back('cancelled');
      if(typeof req.query.code!=='string' || req.query.code.length>4096)return back('invalid');
      const short=await graph('oauth/access_token',null,{client_id:cfg.appId,client_secret:cfg.secret,redirect_uri:cfg.callback,code:req.query.code});
      const long=await graph('oauth/access_token',null,{client_id:cfg.appId,client_secret:cfg.secret,grant_type:'fb_exchange_token',fb_exchange_token:short.access_token});
      if(typeof long.access_token!=='string')throw Error('Missing token');
      const token=long.access_token;
      const permissions=await graph('me/permissions',token);
      const granted=(permissions.data || []).filter(p=>p.status==='granted').map(p=>p.permission);
      if(!granted.includes('pages_show_list'))return back('permissions');
      const who=await graph('me',token,{fields:'id'});
      const pages=[];let after;
      for(let page=0;page<20;page++) {
        const response=await graph('me/accounts',token,{fields:'id,name,access_token,tasks,instagram_business_account{id,username,name}',limit:'100',...(after?{after}:{})});
        pages.push(...(response.data || []));after=response.paging?.cursors?.after;if(!response.paging?.next || !after)break;
      }
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        // Keep previously scheduled jobs attached to surviving destinations.
        const kept=[];
        for(const p of pages) {
            if(!id(p.id) || typeof p.access_token!=='string' || !canPublishToPage(p.tasks))continue;
          for(const platform of ['facebook','instagram']) {
            const ig=p.instagram_business_account;
            if(platform==='instagram'&&!ig?.id)continue;
            const remoteId=platform==='facebook'?p.id:ig.id;
            const result=await client.query(`INSERT INTO olyvex_social_accounts(user_id,platform,remote_id,provider_user_id,display_name,token_cipher,permissions,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+($8*INTERVAL '1 second')) ON CONFLICT(user_id,platform,remote_id) DO UPDATE SET provider_user_id=EXCLUDED.provider_user_id,display_name=EXCLUDED.display_name,token_cipher=EXCLUDED.token_cipher,permissions=EXCLUDED.permissions,expires_at=EXCLUDED.expires_at RETURNING id`,[req.user.id,platform,remoteId,who.id,platform==='facebook'?p.name:ig.username||ig.name||p.name,seal(p.access_token,cfg.key),JSON.stringify(granted),Math.min(Number(long.expires_in)||5184000,5184000)]);
            kept.push(String(result.rows[0].id));
          }
        }
        await client.query('DELETE FROM olyvex_social_accounts WHERE user_id=$1 AND NOT(id=ANY($2::bigint[]))',[req.user.id,kept]);
        await client.query('COMMIT');return back(kept.length?'connected':'empty');
      } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    } catch{return back('failed');}
  });
  app.delete('/api/social/meta/accounts/:id',requireAuth,allowed,mutation,handler(async(req,res)=>{
    if(!id(req.params.id))throw new PublicError('Compte invalide.');
    const result=await pool.query('DELETE FROM olyvex_social_accounts WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]);
    if(!result.rowCount)throw new PublicError('Compte introuvable.',404);
    res.json({ok:true});
  }));
  async function mediaFor(campaign,userId,kind,imageIndex) {
    const data=campaign.campaign_data || {};
    if(kind==='text')return {mime:null,bytes:null,filename:null};
    if(kind==='image') {
      const source=data.generatedImages?.[imageIndex];
      const match=typeof source==='string' && source.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);
      if(!match || match[2].length>14000000)throw new PublicError('Utilisez une image PNG, JPEG ou WebP enregistrée dans cette campagne. Les aperçus de test ne peuvent pas être publiés.');
      const bytes=Buffer.from(match[2],'base64');if(bytes.length>10000000)throw new PublicError('Image trop volumineuse.');
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'olyvex-social-'));
      try {
        const input=path.join(dir,'input.'+match[1]),output=path.join(dir,'image.jpg');
        await fs.writeFile(input,bytes);
        // Instagram accepts JPEG. Convert locally, removing metadata.
        await run(ffmpegPath,['-y','-i',input,'-frames:v','1','-vf','scale=w=min(1440\\,iw):h=-2','-q:v','2','-map_metadata','-1',output],{timeout:20000,maxBuffer:1024*1024});
        const jpeg=await fs.readFile(output);if(jpeg.length>8000000)throw new PublicError('Image JPEG trop volumineuse.');
        return {mime:'image/jpeg',bytes:jpeg,filename:null};
      } finally {await fs.rm(dir,{recursive:true,force:true});}
    }
    const u=new URL(String(data.videoUrl || ''),cfg.origin);
    const filename=u.pathname.split('/').pop();
    if(u.origin!==cfg.origin || !/^\/videos\/vira-[a-zA-Z0-9_-]+\.mp4$/.test(u.pathname) || u.search)throw new PublicError('Sélectionnez une vidéo Olyvex enregistrée dans cette campagne.');
    let owner;try{owner=JSON.parse(await fs.readFile(path.join(videoStorage,filename+'.owner.json'),'utf8'));}catch{throw new PublicError('Vidéo indisponible.');}
    if(String(owner.userId)!==String(userId))throw new PublicError('Vidéo introuvable.',404);
    await fs.access(path.join(videoStorage,filename));
    return {mime:'video/mp4',bytes:null,filename};
  }
  app.get('/api/social/meta/media/:id',handler(async(req,res)=>{
    if(!cfg.ready || !validMediaSignature(req.params.id,req.query.expires,req.query.signature,cfg.key))return res.sendStatus(404);
    const result=await pool.query('SELECT m.* FROM olyvex_social_media m JOIN olyvex_social_posts p ON p.media_id=m.id JOIN olyvex_social_accounts a ON a.id=p.account_id WHERE m.id=$1 AND m.expires_at>NOW() AND p.status IN (\'queued\',\'processing\',\'waiting\')',[req.params.id]);
    const asset=result.rows[0];if(!asset)return res.sendStatus(404);
    res.set('Content-Type',asset.mime);res.set('Cross-Origin-Resource-Policy','cross-origin');
    if(asset.bytes)return res.send(asset.bytes);
    const owner=JSON.parse(await fs.readFile(path.join(videoStorage,asset.filename+'.owner.json'),'utf8'));
    if(String(owner.userId)!==String(asset.user_id))return res.sendStatus(404);
    res.sendFile(path.resolve(videoStorage,asset.filename));
  }));
  app.get('/api/social/meta/posts',requireAuth,allowed,handler(async(req,res)=>{
    const result=await pool.query('SELECT p.id,p.campaign_id,p.status,p.scheduled_at,p.created_at,p.remote_id,p.error,a.platform,a.display_name FROM olyvex_social_posts p JOIN olyvex_social_accounts a ON a.id=p.account_id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 50',[req.user.id]);res.json({posts:result.rows});
  }));
  app.post('/api/social/meta/posts',requireAuth,allowed,mutation,handler(async(req,res)=>{
    needsConfig();const b=req.body || {};
    if(!id(String(b.campaignId)) || !id(String(b.accountId)) || !['image','video','text'].includes(b.kind) || !/^[0-9a-f-]{36}$/.test(b.requestId || ''))throw new PublicError('Publication invalide.');
    const previous=await pool.query('SELECT id,status FROM olyvex_social_posts WHERE user_id=$1 AND request_id=$2',[req.user.id,b.requestId]);if(previous.rowCount)return res.json({post:previous.rows[0]});
    const [accounts,campaigns]=await Promise.all([pool.query('SELECT * FROM olyvex_social_accounts WHERE id=$1 AND user_id=$2',[b.accountId,req.user.id]),pool.query('SELECT * FROM vira_campaigns WHERE id=$1 AND user_id=$2',[b.campaignId,req.user.id])]);
    const account=accounts.rows[0],campaign=campaigns.rows[0];if(!account || !campaign)throw new PublicError('Compte ou campagne introuvable.',404);
    if(new Date(account.expires_at)<=new Date())throw new PublicError('Reconnectez ce compte avant de publier.');
    const permissions=account.permissions;
    if(!(account.platform==='facebook'?permissions.includes('pages_manage_posts'):permissions.includes('instagram_content_publish')))throw new PublicError('Reconnectez le compte et autorisez la publication.');
    if(account.platform==='instagram'&&b.kind==='text')throw new PublicError('Instagram exige une image ou une vidéo.');
    const caption=typeof b.caption==='string'?b.caption.trim():'';
    if(!caption && b.kind==='text' || caption.length>(account.platform==='instagram'?2200:5000))throw new PublicError('Texte vide ou trop long.');
    const imageIndex=Number(b.imageIndex);if(b.kind==='image'&&(!Number.isInteger(imageIndex)||imageIndex<0||imageIndex>3))throw new PublicError('Image invalide.');
    const scheduled=b.scheduledAt?new Date(b.scheduledAt):new Date();
    if(Number.isNaN(+scheduled) || +scheduled<Date.now()-60000 || +scheduled>Date.now()+30*86400000)throw new PublicError('Choisissez une date dans les 30 prochains jours.');
    const count=await pool.query("SELECT COUNT(*) AS n FROM olyvex_social_posts WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",[req.user.id]);if(Number(count.rows[0].n)>=30)throw new PublicError('Limite de 30 publications par heure atteinte.',429);
    const media=await mediaFor(campaign,req.user.id,b.kind,imageIndex);
    const mediaId=media.mime?crypto.randomUUID():null,postId=crypto.randomUUID();const client=await pool.connect();
    try {
      await client.query('BEGIN');
      if(mediaId)await client.query("INSERT INTO olyvex_social_media(id,user_id,mime,bytes,filename,expires_at) VALUES($1,$2,$3,$4,$5,$6)",[mediaId,req.user.id,media.mime,media.bytes,media.filename,new Date(+scheduled+86400000)]);
      const result=await client.query("INSERT INTO olyvex_social_posts(id,user_id,campaign_id,account_id,request_id,kind,caption,media_id,scheduled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status,scheduled_at",[postId,req.user.id,campaign.id,account.id,b.requestId,b.kind,caption,mediaId,scheduled]);
      await client.query('COMMIT');res.status(202).json({post:result.rows[0]});
    } catch(error){await client.query('ROLLBACK');if(error.code==='23505'){const result=await pool.query('SELECT id,status FROM olyvex_social_posts WHERE user_id=$1 AND request_id=$2',[req.user.id,b.requestId]);return res.json({post:result.rows[0]});}throw error;}finally{client.release();}
  }));
  app.delete('/api/social/meta/posts/:id',requireAuth,allowed,mutation,handler(async(req,res)=>{
    if(!/^[0-9a-f-]{36}$/.test(req.params.id))throw new PublicError('Publication invalide.');
    const result=await pool.query("UPDATE olyvex_social_posts SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status='queued' RETURNING id",[req.params.id,req.user.id]);
    if(!result.rowCount)throw new PublicError('Seule une publication en attente peut être annulée.');res.json({ok:true});
  }));
  async function publish(post) {
    const result=await pool.query('SELECT * FROM olyvex_social_accounts WHERE id=$1 AND user_id=$2',[post.account_id,post.user_id]);const account=result.rows[0];
    if(!account)throw new PublicError('Compte déconnecté.');
    if(new Date(account.expires_at)<=new Date())throw new PublicError('Connexion expirée. Reconnectez votre compte.');
    const token=unseal(account.token_cipher,cfg.key);
    if(account.platform==='facebook' && post.kind==='video' && post.remote_id) {
      const info=await graph(post.remote_id,token,{fields:'status'});
      if(info.status?.video_status==='ready')await pool.query("UPDATE olyvex_social_posts SET status='published',error=NULL WHERE id=$1",[post.id]);
      else if(info.status?.video_status==='error' || Date.now()-new Date(post.started_at).getTime()>3600000)throw new PublicError('Facebook ne peut pas préparer cette vidéo. Vérifiez-la sur votre Page.');
      else await pool.query("UPDATE olyvex_social_posts SET status='waiting' WHERE id=$1",[post.id]);
      return;
    }
    const expires=Date.now()+86400000;
    const mediaUrl=post.media_id?`${cfg.origin}/api/social/meta/media/${post.media_id}?expires=${expires}&signature=${signedMedia(post.media_id,expires,cfg.key)}`:null;
    if(account.platform==='instagram' && !post.container_id) {
      const container=await graph(account.remote_id+'/media',token,{caption:post.caption,...(post.kind==='video'?{media_type:'REELS',video_url:mediaUrl,share_to_feed:'true'}:{image_url:mediaUrl})},'POST');
      if(!id(container.id))throw new Error('Missing container');
      await pool.query("UPDATE olyvex_social_posts SET status='waiting',container_id=$2 WHERE id=$1",[post.id,container.id]);return;
    }
    if(account.platform==='instagram') {
      const info=await graph(post.container_id,token,{fields:'status_code'});
      if(info.status_code==='IN_PROGRESS') {
        if(Date.now()-new Date(post.started_at).getTime()>3600000)throw new PublicError('Préparation Instagram trop longue. Vérifiez votre média.');
        await pool.query("UPDATE olyvex_social_posts SET status='waiting' WHERE id=$1",[post.id]);return;
      }
      if(info.status_code!=='FINISHED')throw new PublicError('Instagram ne peut pas préparer ce média.');
    }
    // Record dispatch BEFORE issuing the irreversible request. Never retry blindly.
    await pool.query('UPDATE olyvex_social_posts SET dispatched=true WHERE id=$1',[post.id]);
    let published;
    if(account.platform==='instagram')published=await graph(account.remote_id+'/media_publish',token,{creation_id:post.container_id},'POST');
    else if(post.kind==='text')published=await graph(account.remote_id+'/feed',token,{message:post.caption},'POST');
    else if(post.kind==='image')published=await graph(account.remote_id+'/photos',token,{url:mediaUrl,caption:post.caption,published:'true'},'POST');
    else published=await graph(account.remote_id+'/videos',token,{file_url:mediaUrl,description:post.caption},'POST',true);
    if(!published.id)throw Error('Missing published identifier');
    if(account.platform==='facebook' && post.kind==='video') {
      await pool.query("UPDATE olyvex_social_posts SET status='waiting',remote_id=$2 WHERE id=$1",[post.id,published.id]);return;
    }
    await pool.query("UPDATE olyvex_social_posts SET status='published',remote_id=$2,error=NULL WHERE id=$1",[post.id,published.post_id || published.id]);
  }
  async function tick() {
    if(!cfg.ready)return;
    // Don't repeat requests left in flight by a crashed process. One-hour grace
    // permits another instance to finish an ordinary Meta request.
    await pool.query("UPDATE olyvex_social_posts SET status=CASE WHEN dispatched THEN 'uncertain' ELSE 'failed' END,error='Traitement interrompu. Vérifiez le réseau avant de republier.' WHERE status='processing' AND claimed_at<NOW()-INTERVAL '1 hour'");
    const result=await pool.query(`UPDATE olyvex_social_posts SET status='processing',claimed_at=NOW(),started_at=COALESCE(started_at,NOW()) WHERE id=(SELECT id FROM olyvex_social_posts WHERE status IN ('queued','waiting') AND scheduled_at<=NOW() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
    const post=result.rows[0];if(!post)return;active.add(post.id);
    try {await publish(post);}catch(error){
      const current=await pool.query('SELECT dispatched FROM olyvex_social_posts WHERE id=$1',[post.id]);
      const uncertain=current.rows[0]?.dispatched && !(error instanceof PublicError);
      await pool.query('UPDATE olyvex_social_posts SET status=$2,error=$3 WHERE id=$1',[post.id,uncertain?'uncertain':'failed',uncertain?'Réponse Meta interrompue. Vérifiez le réseau avant de republier.':error instanceof PublicError?error.message:'Publication interrompue. Vérifiez le fichier et réessayez.']);
    }finally{active.delete(post.id);}
  }
  let timer,busy=false;
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS olyvex_social_states(state_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS olyvex_social_accounts(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,platform TEXT NOT NULL CHECK(platform IN ('facebook','instagram')),remote_id TEXT NOT NULL,provider_user_id TEXT NOT NULL,display_name TEXT NOT NULL,token_cipher TEXT NOT NULL,permissions JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,UNIQUE(user_id,platform,remote_id));
      CREATE TABLE IF NOT EXISTS olyvex_social_media(id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,mime TEXT NOT NULL,bytes BYTEA,filename TEXT,expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS olyvex_social_posts(id UUID PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,campaign_id BIGINT REFERENCES vira_campaigns(id) ON DELETE SET NULL,account_id BIGINT NOT NULL REFERENCES olyvex_social_accounts(id) ON DELETE CASCADE,request_id UUID NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('text','image','video')),caption TEXT NOT NULL,media_id UUID REFERENCES olyvex_social_media(id) ON DELETE SET NULL,status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','waiting','published','failed','uncertain','cancelled')),scheduled_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),started_at TIMESTAMPTZ,claimed_at TIMESTAMPTZ,dispatched BOOLEAN NOT NULL DEFAULT false,container_id TEXT,remote_id TEXT,error TEXT,UNIQUE(user_id,request_id));
      CREATE INDEX IF NOT EXISTS olyvex_social_posts_pending ON olyvex_social_posts(status,scheduled_at);`);
      if(cfg.ready){timer=setInterval(async()=>{if(busy)return;busy=true;try{await tick();await pool.query("DELETE FROM olyvex_social_media WHERE expires_at<NOW(); DELETE FROM olyvex_social_states WHERE expires_at<NOW()");}catch{console.error('Traitement social temporairement indisponible.');}finally{busy=false;}},15000);timer.unref();}
    },
    stop(){clearInterval(timer);},
    tick,
  };
}
