import crypto from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateImageRequest(body) {
  if (!uuid.test(String(body?.requestId || '')) || !Array.isArray(body?.prompts) || body.prompts.length !== 4 ||
      body.prompts.some(p => typeof p !== 'string' || !p.trim() || p.length > 3000)) {
    throw new Error('Préparez quatre descriptions de scènes valides.');
  }
  return { id: body.requestId.toLowerCase(), prompts: body.prompts.map(p => p.trim()) };
}

// No automatic provider retries: a timeout may already have incurred a charge.
export async function generateImageBatch(prompts, { key, model = 'gpt-image-1-mini', fetchImpl = fetch, onProgress = async () => {} }) {
  const images = [];
  for (let index = 0; index < prompts.length; index++) {
    const response = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(150000),
      body: JSON.stringify({ model, prompt: prompts[index], n: 1, size: '1024x1536', quality: 'low',
        output_format: 'jpeg', output_compression: 70 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const blocked = data?.error?.code === 'moderation_blocked' || data?.error?.code === 'content_policy_violation';
      const error = new Error(blocked ? 'Une description a été refusée. Modifiez le contenu et réessayez.' :
        response.status === 429 ? 'Le fournisseur IA est temporairement indisponible ou son quota est épuisé.' :
        'La génération IA a échoué. Réessayez plus tard.');
      error.providerStatus = response.status;
      throw error;
    }
    const encoded = data?.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error('Le fournisseur n’a pas renvoyé une image valide.');
    }
    const image = Buffer.from(encoded, 'base64');
    if (image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) throw new Error('Format d’image IA invalide.');
    images.push(`data:image/jpeg;base64,${encoded}`);
    await onProgress(index + 1);
  }
  return images;
}

export function installImageGeneration({ app, pool, requireAuth, requireCreation, env = process.env }) {
  const enabled = () => env.AI_IMAGES_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY);
  const allowed = user => env.AI_IMAGES_ALLOW_CLIENTS === 'true' ||
    [env.ADMIN_EMAIL, ...(env.AI_IMAGE_TEST_EMAILS || '').split(',')].filter(Boolean)
      .some(email => email.trim().toLowerCase() === String(user.email).toLowerCase());
  const dayLimit = Math.max(4, Math.min(1000, Number.parseInt(env.AI_IMAGE_DAILY_LIMIT || '16', 10) || 16));
  const ownerRun = crypto.randomUUID();
  const publicJob = row => ({ ok: true, jobId: row.id, status: row.status, completed: row.completed,
    images: row.status === 'completed' ? row.images : undefined,
    error: row.status === 'failed' ? row.error : undefined });

  async function recoverExpired() {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(91346, 0)');
      const expired = await db.query(`UPDATE vira_image_jobs SET status='failed', error='La génération a été interrompue. Les crédits ont été rendus.'
        WHERE status='running' AND updated_at < NOW() - INTERVAL '5 minutes' RETURNING usage_id`);
      for (const row of expired.rows) await db.query('DELETE FROM vira_image_usage WHERE id=$1', [row.usage_id]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
    finally { db.release(); }
  }

  async function perform(id, prompts) {
    const heartbeat = setInterval(() => {
      pool.query("UPDATE vira_image_jobs SET updated_at=NOW() WHERE id=$1 AND owner_run=$2 AND status='running'", [id, ownerRun]).catch(() => {});
    }, 30000);
    heartbeat.unref();
    try {
      const images = await generateImageBatch(prompts, { key: env.OPENAI_API_KEY, model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1-mini',
        onProgress: async completed => {
          const result = await pool.query("UPDATE vira_image_jobs SET completed=$2,updated_at=NOW() WHERE id=$1 AND status='running' AND owner_run=$3", [id, completed, ownerRun]);
          if (!result.rowCount) throw new Error('La génération a été interrompue.');
        } });
      await pool.query("UPDATE vira_image_jobs SET images=$2::jsonb,status='completed',completed=4,updated_at=NOW() WHERE id=$1 AND status='running' AND owner_run=$3", [id, JSON.stringify(images), ownerRun]);
    } catch (error) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const failed = await db.query("UPDATE vira_image_jobs SET status='failed',error=$2,updated_at=NOW() WHERE id=$1 AND status='running' AND owner_run=$3 RETURNING usage_id", [id,
          (error?.name === 'TimeoutError' ? 'La génération a pris trop de temps.' : error.message || 'Génération interrompue.') + ' Aucun crédit image décompté.', ownerRun]);
        for (const row of failed.rows) await db.query('DELETE FROM vira_image_usage WHERE id=$1', [row.usage_id]);
        await db.query('COMMIT');
      } catch { await db.query('ROLLBACK').catch(() => {}); }
      finally { db.release(); }
      // Keep credentials, prompts and provider response bodies out of logs.
      console.error('IMAGE GENERATION FAILED', { status: error.providerStatus || null });
    } finally { clearInterval(heartbeat); }
  }

  app.get('/api/images/config', requireAuth, (req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ ok: true, enabled: enabled() && allowed(req.user), batchSize: 4, monthlyLimit: 16 });
  });
  app.get('/api/images/jobs/:id', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!uuid.test(req.params.id)) return res.status(404).json({ ok: false, error: 'Génération introuvable.' });
    try {
      await recoverExpired();
      const { rows } = await pool.query('SELECT * FROM vira_image_jobs WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      if (!rows[0]) return res.status(404).json({ ok: false, error: 'Génération introuvable.' });
      return res.json(publicJob(rows[0]));
    } catch { return res.status(503).json({ ok: false, error: 'Suivi indisponible. Réessayez.' }); }
  });
  app.post('/api/images/generate', requireAuth, requireCreation, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    let request;
    try { request = validateImageRequest(req.body); } catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(request.prompts)).digest('hex');
    let db;
    let started = false;
    try {
      await recoverExpired();
      db = await pool.connect();
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(91346, 0)');
      const existing = (await db.query('SELECT * FROM vira_image_jobs WHERE id=$1', [request.id])).rows[0];
      if (existing) {
        await db.query('ROLLBACK');
        if (String(existing.user_id) !== String(req.user.id) || existing.fingerprint !== fingerprint) return res.status(409).json({ ok: false, error: 'Cette demande ne correspond pas à votre campagne.' });
        return res.json(publicJob(existing));
      }
      if (!enabled() || !allowed(req.user)) { await db.query('ROLLBACK'); return res.status(503).json({ ok: false, error: 'La génération IA n’est pas encore activée pour ce compte. Vous pouvez importer vos images.' }); }
      const daily = await db.query("SELECT COUNT(*)::int AS count FROM vira_image_jobs WHERE created_at >= DATE_TRUNC('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'", []);
      const active = await db.query("SELECT COUNT(*)::int AS count FROM vira_image_jobs WHERE status='running'", []);
      if ((daily.rows[0].count + 1) * 4 > dayLimit || active.rows[0].count >= 2) { await db.query('ROLLBACK'); return res.status(429).json({ ok: false, error: 'La capacité de génération est atteinte. Réessayez plus tard ou importez vos images.' }); }
      await db.query('SELECT pg_advisory_xact_lock(91344,$1::integer)', [req.user.id]);
      const usage = await db.query("SELECT COALESCE(SUM(quantity),0)::int AS count FROM vira_image_usage WHERE user_id=$1 AND period_start=DATE_TRUNC('month',NOW())::date", [req.user.id]);
      if (usage.rows[0].count + 4 > 16) { await db.query('ROLLBACK'); return res.status(429).json({ ok: false, error: 'Il faut quatre crédits images disponibles pour générer les scènes.' }); }
      const slot = await db.query('INSERT INTO vira_image_usage(user_id,quantity) VALUES($1,4) RETURNING id', [req.user.id]);
      const result = await db.query("INSERT INTO vira_image_jobs(id,user_id,fingerprint,usage_id,owner_run) VALUES($1,$2,$3,$4,$5) RETURNING *", [request.id, req.user.id, fingerprint, slot.rows[0].id, ownerRun]);
      await db.query('COMMIT'); started = true;
      res.status(202).json(publicJob(result.rows[0]));
    } catch { if (db) await db.query('ROLLBACK').catch(() => {}); res.status(503).json({ ok: false, error: 'Impossible de démarrer la génération. Réessayez.' }); }
    finally { db?.release(); }
    if (started) void perform(request.id, request.prompts).catch(() => {});
  });
  return { async init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS vira_image_jobs (
      id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, usage_id BIGINT NOT NULL, owner_run UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'running', completed INTEGER NOT NULL DEFAULT 0,
      images JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS vira_image_jobs_created_idx ON vira_image_jobs(created_at)');
    await recoverExpired();
    // Jobs contain a short-lived recovery copy; campaign images remain in campaigns.
    await pool.query("DELETE FROM vira_image_jobs WHERE status <> 'running' AND created_at < NOW() - INTERVAL '7 days'");
  } };
}
