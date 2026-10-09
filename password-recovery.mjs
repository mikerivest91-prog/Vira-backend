import crypto from 'node:crypto';

export const recoveryMessage = 'Si cette adresse correspond à un compte, un lien de récupération vous sera envoyé.';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
export function recoveryUrl(origin, token) {
  const url = new URL('/reset-password', origin);
  if (url.protocol !== 'https:') throw new Error('HTTPS requis');
  url.hash = `token=${token}`;
  return url.href;
}

export function installPasswordRecovery({ app, pool, hashPassword, clearSessionCookie, sendMail, env = process.env }) {
  const enabled = Boolean(sendMail && env.APP_ORIGIN);
  if (enabled) recoveryUrl(env.APP_ORIGIN, 'test');
  app.get('/api/auth/recovery-config', (_req, res) => res.json({ enabled }));
  app.post('/api/auth/forgot-password', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return res.status(503).json({ error: 'La récupération par courriel est temporairement indisponible.' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Adresse courriel invalide.' });
    try {
      const secret = env.AUTH_RATE_LIMIT_SECRET || env.SOCIAL_TOKEN_KEY || env.DATABASE_URL;
      if (!secret) throw new Error('Rate secret unavailable');
      for (const [key, limit] of [[`email:${email}`, 3], [`ip:${req.ip}`, 20]]) {
        const bucket = crypto.createHmac('sha256', secret).update(key).digest('hex');
        const result = await pool.query(`INSERT INTO vira_recovery_attempts (bucket, window_start, attempts)
          VALUES ($1, date_trunc('hour', NOW()), 1) ON CONFLICT (bucket, window_start)
          DO UPDATE SET attempts = vira_recovery_attempts.attempts + 1 RETURNING attempts`, [bucket]);
        if (result.rows[0].attempts > limit) { res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'Trop de demandes. Réessayez plus tard.' }); }
      }
      const user = (await pool.query('SELECT id, email FROM vira_users WHERE email=$1', [email])).rows[0];
      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = digest(token);
        await pool.query(`INSERT INTO vira_password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,NOW()+INTERVAL '15 minutes')`, [tokenHash, user.id]);
        try {
          await sendMail({ to: user.email, subject: 'Olyvex — récupération de votre compte',
            text: `Pour choisir un nouveau mot de passe, ouvrez ce lien dans les 15 prochaines minutes :\n\n${recoveryUrl(env.APP_ORIGIN, token)}\n\nSi vous n’avez pas demandé ce lien, ignorez ce courriel.` });
        } catch { await pool.query('DELETE FROM vira_password_resets WHERE token_hash=$1', [tokenHash]); }
      }
      return res.json({ message: recoveryMessage });
    } catch { return res.status(503).json({ error: 'Service temporairement indisponible. Réessayez plus tard.' }); }
  });
  app.post('/api/auth/reset-password', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Choisissez un mot de passe de 10 à 128 caractères.' });
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const reset = (await client.query(`SELECT user_id FROM vira_password_resets WHERE token_hash=$1 AND expires_at>NOW() FOR UPDATE`, [digest(token)])).rows[0];
      if (!reset) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Lien invalide ou expiré.' }); }
      // Serialize resets for this user, then invalidate every outstanding link and session.
      await client.query('SELECT id FROM vira_users WHERE id=$1 FOR UPDATE', [reset.user_id]);
      await client.query('UPDATE vira_users SET password_hash=$1 WHERE id=$2', [await hashPassword(password), reset.user_id]);
      await client.query('DELETE FROM vira_password_resets WHERE user_id=$1', [reset.user_id]);
      await client.query('DELETE FROM vira_sessions WHERE user_id=$1', [reset.user_id]);
      await client.query('COMMIT');
      clearSessionCookie(res);
      return res.json({ message: 'Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.' });
    } catch { if (client) await client.query('ROLLBACK').catch(() => {}); return res.status(503).json({ error: 'Service temporairement indisponible.' }); }
    finally { client?.release(); }
  });
  return { enabled, async init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS vira_password_resets (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
      CREATE INDEX IF NOT EXISTS vira_password_resets_user ON vira_password_resets(user_id);
      CREATE TABLE IF NOT EXISTS vira_recovery_attempts (bucket TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(bucket,window_start));
      DELETE FROM vira_password_resets WHERE expires_at<NOW();
      DELETE FROM vira_recovery_attempts WHERE window_start<NOW()-INTERVAL '2 days';`);
  } };
}

