import crypto from 'node:crypto';
import net from 'node:net';

export function normalizeAuthAddress(value) {
  let ip=String(value || '').toLowerCase().replace(/^::ffff:/,'');
  if (!net.isIP(ip)) return 'unknown';
  // Group IPv6 clients by their /64 network rather than a rotating host address.
  if (net.isIP(ip) === 6) {
    const [left,right='']=ip.split('::');
    const a=left?left.split(':'):[], b=right?right.split(':'):[];
    const groups=ip.includes('::')?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
    ip=groups.slice(0,4).map(x=>x.padStart(4,'0')).join(':')+'::/64';
  }
  return ip;
}

export function installAuthProtection({app,pool,env=process.env}) {
  const secret=env.AUTH_RATE_LIMIT_SECRET || env.SOCIAL_TOKEN_KEY || env.DATABASE_URL || crypto.randomBytes(32).toString('hex');
  const key=(scope,value)=>crypto.createHmac('sha256',secret).update(scope+'\0'+value).digest('hex');
  // Render terminates requests at its reverse proxy. Trust exactly one hop,
  // not arbitrary client-supplied entries at the start of X-Forwarded-For.
  if (env.RENDER === 'true') app.set('trust proxy',1);
  let lastCleanup=0;
  function limit(scope,ipLimit,emailLimit,seconds) {
    return async(req,res,next)=>{
      const email=String(req.body?.email || '').trim().toLowerCase();
      const password=req.body?.password;
      if (!email || email.length>254 || !email.includes('@') || typeof password!=='string' || password.length>128 || !password.length) {
        return res.status(400).json({ok:false,error:'Adresse courriel ou mot de passe invalide.'});
      }
      res.set('Cache-Control','no-store');
      try {
        const buckets=[[key(scope+':ip',normalizeAuthAddress(req.ip || req.socket?.remoteAddress)),ipLimit],
          [key(scope+':email',email),emailLimit]];
        for(const [identifier,max] of buckets) {
          const {rows}=await pool.query(`INSERT INTO vira_auth_attempts(bucket,window_start,attempts)
            VALUES($1,TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM NOW())/$2)*$2),1)
            ON CONFLICT(bucket,window_start) DO UPDATE SET attempts=vira_auth_attempts.attempts+1
            RETURNING attempts, GREATEST(1,CEIL(EXTRACT(EPOCH FROM window_start + $2 * INTERVAL '1 second' - NOW())))::int AS retry_after`,[identifier,seconds]);
          if(rows[0].attempts>max) {
            res.set('Retry-After',String(rows[0].retry_after));
            return res.status(429).json({ok:false,error:'Trop de tentatives. Attendez quelques minutes avant de réessayer.'});
          }
        }
        if(Date.now()-lastCleanup>3600000) {
          lastCleanup=Date.now();
          void pool.query("DELETE FROM vira_auth_attempts WHERE window_start < NOW() - INTERVAL '1 day'").catch(()=>{});
        }
        return next();
      } catch {
        return res.status(503).json({ok:false,error:'Connexion temporairement indisponible. Réessayez dans quelques instants.'});
      }
    };
  }
  app.post('/api/auth/login',limit('login',60,10,900));
  app.post('/api/auth/register',limit('register',10,5,3600));
  return {async init(){
    await pool.query(`CREATE TABLE IF NOT EXISTS vira_auth_attempts(
      bucket TEXT NOT NULL,window_start TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(bucket,window_start))`);
    await pool.query('CREATE INDEX IF NOT EXISTS vira_auth_attempts_expiry_idx ON vira_auth_attempts(window_start)');
  }};
}
