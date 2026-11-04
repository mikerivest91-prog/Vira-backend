import fs from 'node:fs/promises';
import path from 'node:path';

const MB=1024*1024;
const bounded=(value,fallback,min,max)=>{const n=Number(value);return Number.isSafeInteger(n)&&n>=min&&n<=max?n:fallback;};
export function resourceLimits(env={}) {
  return {voicePerUser:bounded(env.VOICE_DAILY_LIMIT,20,1,1000),voiceGlobal:bounded(env.VOICE_GLOBAL_DAILY_LIMIT,100,1,10000),
    storageBytes:bounded(env.MEDIA_STORAGE_LIMIT_MB,200,20,10000)*MB,
    freeBytes:bounded(env.MEDIA_MIN_FREE_MB,100,20,10000)*MB};
}
const storageError=()=>Object.assign(new Error('Votre espace média est plein. Contactez le support pour libérer de l’espace.'),{code:'STORAGE_QUOTA'});
export async function ownedMediaBytes(storage,userId,io=fs) {
  if(!/^\d+$/.test(String(userId)))throw Error('Invalid owner');
  let total=0;
  for(const [folder,prefix] of [['.audio',`audio-${userId}-`],['.clips',`clip-${userId}-`]]){
    const directory=path.join(storage,folder);
    const entries=await io.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const entry of entries)if(entry.isFile()&&entry.name.startsWith(prefix))total+=(await io.stat(path.join(directory,entry.name))).size;
  }
  const entries=await io.readdir(storage,{withFileTypes:true});
  for(const entry of entries){
    if(!entry.isFile()||!/^vira-[a-zA-Z0-9_-]+\.mp4\.owner\.json$/.test(entry.name))continue;
    const owner=JSON.parse(await io.readFile(path.join(storage,entry.name),'utf8'));
    if(String(owner.userId)!==String(userId))continue;
    total+=(await io.stat(path.join(storage,entry.name.slice(0,-11))).catch(error=>{if(error.code==='ENOENT')return {size:0};throw error;})).size;
  }
  return total;
}

export function createResourceProtection({pool,storage,temporaryStorage,env=process.env,io=fs}) {
  const limits=resourceLimits(env);
  // One media job at a time on the shared disk. A PostgreSQL session lock also
  // works across processes, and is released automatically on connection loss.
  const paths=new Map([
    ['/api/audio/generate',8],['/api/audio/upload',20],['/api/video/import-clip',80],
    ['/api/video/assemble',500],['/api/video/assemble-clips',100],['/api/video/free-assemble',100]
  ]);
  const reject=(res,status,message,retry)=>{if(retry)res.set('Retry-After',String(retry));return res.status(status).json({ok:false,error:message});};
  async function media(req,res,next){
    const budget=paths.get(req.path.toLowerCase().replace(/\/+$/,''));
    if(req.method!=='POST'||!budget)return next();
    if(!req.user)return reject(res,401,'Connexion requise.');
    let db,locked=false,released=false;
    const release=async()=>{
      if(released||!db)return;released=true;
      try{if(locked)await db.query('SELECT pg_advisory_unlock(91349,0)');db.release();}
      catch{db.release(true);}
    };
    try{
      db=await pool.connect();
      if(res.destroyed){await release();return;}
      locked=Boolean((await db.query('SELECT pg_try_advisory_lock(91349,0) AS acquired')).rows[0]?.acquired);
      if(!locked){await release();return reject(res,429,'Une préparation média est en cours. Réessayez dans quelques instants.',5);}
      if(res.destroyed){await release();return;}
      const used=await ownedMediaBytes(storage,req.user.id,io);
      if(used>=limits.storageBytes){await release();return reject(res,413,storageError().message);}
      for(const directory of new Set([storage,temporaryStorage])){
        const disk=await io.statfs(directory);
        if(disk.bavail*disk.bsize<limits.freeBytes+budget*MB){await release();return reject(res,507,'L’espace serveur disponible est insuffisant. Réessayez plus tard.');}
      }
      if(res.destroyed){await release();return;}
      res.locals.acceptMedia=async files=>{
        let added=0;for(const filename of files)added+=(await io.stat(filename)).size;
        if(used+added>limits.storageBytes){await Promise.allSettled(files.map(filename=>io.unlink(filename)));throw storageError();}
      };
      res.locals.releaseMedia=release;
      res.locals.mediaProcessing=false;
      res.once('finish',()=>void release());
      res.once('close',()=>{if(!res.locals.mediaProcessing)void release();});
      req.setTimeout?.(60000,()=>req.destroy());
      return next();
    }catch{await release();if(!res.destroyed)return reject(res,503,'La protection des ressources est temporairement indisponible. Réessayez plus tard.');}
  }
  async function reserveVoice(userId){
    const db=await pool.connect();
    try{
      await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(91347,0)');
      const result=await db.query("SELECT user_id,requests FROM olyvex_voice_daily_usage WHERE day=(NOW() AT TIME ZONE 'UTC')::date AND user_id=ANY($1::bigint[])",[[0,userId]]);
      const used=new Map(result.rows.map(row=>[String(row.user_id),Number(row.requests)]));
      if((used.get('0')||0)>=limits.voiceGlobal||(used.get(String(userId))||0)>=limits.voicePerUser){await db.query('ROLLBACK');return false;}
      await db.query("INSERT INTO olyvex_voice_daily_usage(day,user_id,requests) SELECT (NOW() AT TIME ZONE 'UTC')::date,id,1 FROM unnest($1::bigint[]) AS ids(id) ON CONFLICT(day,user_id) DO UPDATE SET requests=olyvex_voice_daily_usage.requests+1",[[0,userId]]);
      await db.query('COMMIT');return true;
    }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
  }
  return {media,reserveVoice,limits,run:handler=>async(req,res,next)=>{
    res.locals.mediaProcessing=true;req.setTimeout?.(0);
    try{return await handler(req,res,next);}finally{await res.locals.releaseMedia?.();}
  },async init(){
    await pool.query('CREATE TABLE IF NOT EXISTS olyvex_voice_daily_usage(day DATE NOT NULL,user_id BIGINT NOT NULL,requests INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,user_id))');
    await pool.query("DELETE FROM olyvex_voice_daily_usage WHERE day<(NOW() AT TIME ZONE 'UTC')::date-31");
  }};
}
