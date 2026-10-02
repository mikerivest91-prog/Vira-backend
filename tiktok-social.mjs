import crypto from 'node:crypto';
import {seal,unseal} from './meta-social.mjs';

export function tiktokConfiguration(env) {
  let origin='';try {const u=new URL(env.APP_ORIGIN);if(u.protocol==='https:'&&u.pathname==='/'&&!u.username&&!u.password)origin=u.origin;}catch{}
  const key=/^[a-f0-9]{64}$/i.test(env.SOCIAL_TOKEN_KEY||'')?Buffer.from(env.SOCIAL_TOKEN_KEY,'hex'):null;
  return {origin,key,client:env.TIKTOK_CLIENT_KEY,secret:env.TIKTOK_CLIENT_SECRET,callback:origin+'/api/social/tiktok/callback',ready:Boolean(origin&&key&&env.TIKTOK_CLIENT_KEY&&env.TIKTOK_CLIENT_SECRET)};
}
export function installTikTokSocial({app,pool,requireAuth,env=process.env,fetchImpl=fetch}) {
  const cfg=tiktokConfiguration(env),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const permitted=u=>env.SOCIAL_ENABLE_CLIENTS==='true'||Boolean(env.SOCIAL_TEST_EMAIL||env.ADMIN_EMAIL)&&String(u.email).toLowerCase()===String(env.SOCIAL_TEST_EMAIL||env.ADMIN_EMAIL).trim().toLowerCase();
  const allowed=(req,res,next)=>permitted(req.user)?next():res.status(403).json({error:'TikTok est en test privé.'});
  const mutation=(req,res,next)=>req.get('origin')===cfg.origin&&req.get('x-olyvex-request')==='1'?next():res.status(403).json({error:'Requête non autorisée.'});
  const handler=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch{res.status(503).json({error:'TikTok est indisponible. Réessayez ou reconnectez votre compte.'});}};
  async function oauth(endpoint,params) {
    const r=await fetchImpl('https://open.tiktokapis.com/v2/oauth/'+endpoint+'/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_key:cfg.client,client_secret:cfg.secret,...params}),redirect:'error',signal:AbortSignal.timeout(20000)});
    const data=await r.json();if(!r.ok||data.error)throw Error('TikTok OAuth failed');return data;
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
    try{
      if(!cfg.ready||!/^[a-f0-9]{64}$/.test(req.query.state||''))return back('invalid');
      const state=await pool.query('DELETE FROM olyvex_tiktok_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>NOW() RETURNING user_id',[hash(req.query.state),req.user.id]);
      if(!state.rowCount)return back('invalid');if(req.query.error)return back('cancelled');if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>4096)return back('invalid');
      const data=await oauth('token',{grant_type:'authorization_code',code:req.query.code,redirect_uri:cfg.callback});validateToken(data);
      if(!String(data.scope||'').split(',').includes('user.info.basic'))return back('permissions');
      const r=await fetchImpl('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',{headers:{Authorization:'Bearer '+data.access_token},redirect:'error',signal:AbortSignal.timeout(20000)});const profile=await r.json();
      if(!r.ok||profile.error?.code!=='ok'||profile.data?.user?.open_id!==data.open_id||typeof profile.data.user.display_name!=='string')throw Error('Profile unavailable');
      await storeToken(req.user.id,data,profile.data.user.display_name);return back('connected');
    }catch{return back('failed');}
  });
  app.delete('/api/social/tiktok/accounts/:id',requireAuth,allowed,mutation,handler(async(req,res)=>{
    if(!/^[1-9][0-9]{0,19}$/.test(req.params.id))return res.status(400).json({error:'Compte invalide.'});
    const r=await pool.query('SELECT * FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Compte introuvable.'});
    await oauth('revoke',{token:unseal(r.rows[0].token_cipher,cfg.key)});
    await pool.query('DELETE FROM olyvex_tiktok_accounts WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);res.json({ok:true});
  }));
  let timer;
  async function refresh() {
    if(!cfg.ready)return;
    // Database leases prevent simultaneous refresh-token rotation across instances.
    const r=await pool.query("UPDATE olyvex_tiktok_accounts SET refresh_claimed_at=NOW() WHERE id IN (SELECT id FROM olyvex_tiktok_accounts WHERE expires_at<NOW()+INTERVAL '10 minutes' AND refresh_expires_at>NOW() AND (refresh_claimed_at IS NULL OR refresh_claimed_at<NOW()-INTERVAL '5 minutes') ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *");
    for(const account of r.rows){try{const data=await oauth('token',{grant_type:'refresh_token',refresh_token:unseal(account.refresh_cipher,cfg.key)});if(data.open_id!==account.remote_id)throw Error('Identity mismatch');await storeToken(account.user_id,data,account.display_name);await pool.query('UPDATE olyvex_tiktok_accounts SET refresh_claimed_at=NULL WHERE id=$1',[account.id]);}catch{/* Retry after lease expiry; never log credentials. */}}
  }
  return {async init(){await pool.query(`CREATE TABLE IF NOT EXISTS olyvex_tiktok_states(state_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS olyvex_tiktok_accounts(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,remote_id TEXT NOT NULL,display_name TEXT NOT NULL,token_cipher TEXT NOT NULL,refresh_cipher TEXT NOT NULL,permissions JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL,refresh_expires_at TIMESTAMPTZ NOT NULL,refresh_claimed_at TIMESTAMPTZ,UNIQUE(user_id,remote_id));`);timer=setInterval(()=>refresh().catch(()=>{}),60000);timer.unref?.();},stop(){clearInterval(timer);}};
}
