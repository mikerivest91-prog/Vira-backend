import "dotenv/config";
import express from "express";
import { createTestBilling } from "./stripe-billing.mjs";
import { audioFile, wavDuration, prepareAudio, synthesizeAudio } from "./audio-service.mjs";
import multer from "multer";
import cors from "cors";
import crypto from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs";
import path from "node:path";
import { assembleVideoClips } from "./video-assembler.mjs";
const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);
ffmpeg.setFfmpegPath(ffmpegPath);
const VIDEO_TEMP_DIR = path.join(process.cwd(), "tmp", "videos");
const uploadVideoClips = multer({
  dest: VIDEO_TEMP_DIR,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 3
  }
});
if (!fs.existsSync(VIDEO_TEMP_DIR)) {
  fs.mkdirSync(VIDEO_TEMP_DIR, { recursive: true });
}
const AUDIO_TEMP_DIR = path.join(process.cwd(), "tmp", "audio");
fs.mkdirSync(AUDIO_TEMP_DIR, { recursive: true });
const uploadAudio = multer({ dest: AUDIO_TEMP_DIR, limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const audioJobs = new Set();
async function withAudioJob(req, res, work) {
  const key = String(req.user.id);
  if (audioJobs.has(key) || audioJobs.size >= 2) return res.status(429).json({ ok:false, error:"Une préparation audio est en cours. Réessayez dans un instant." });
  audioJobs.add(key);
  try { return await work(); } finally { audioJobs.delete(key); }
}
const app = express();
const port = Number(process.env.PORT || 10000);

app.use(cors({
  origin: true,
  credentials: true
}));

app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => billing.webhook(req, res));
app.use(express.json({ limit: "2mb" }));
app.get("/", (_req, res) => res.sendFile(path.resolve("index.html")));
app.get("/index.html", (_req, res) => res.sendFile(path.resolve("index.html")));
app.use("/videos", express.static(VIDEO_TEMP_DIR));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

const SESSION_COOKIE = "vira_session";
const SESSION_DAYS = 30;

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function parseCookies(req) {
  const cookies = {};

  String(req.headers.cookie || "")
    .split(";")
    .forEach(part => {
      const index = part.indexOf("=");

      if (index === -1) return;

      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();

      if (key) {
        try { cookies[key] = decodeURIComponent(value); } catch { /* Ignore malformed cookies. */ }
      }
    });

  return cookies;
}

function sessionHash(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);

  const derivedKey = await scrypt(
    password,
    salt,
    64
  );

  return [
    "scrypt",
    salt.toString("hex"),
    Buffer.from(derivedKey).toString("hex")
  ].join("$");
}

async function verifyPassword(password, stored) {
  try {
    const [algorithm, saltHex, hashHex] =
      String(stored).split("$");

    if (algorithm !== "scrypt") return false;

    const derivedKey = await scrypt(
      password,
      Buffer.from(saltHex, "hex"),
      64
    );

    const storedHash = Buffer.from(hashHex, "hex");
    const candidate = Buffer.from(derivedKey);

    if (storedHash.length !== candidate.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      storedHash,
      candidate
    );
  } catch {
    return false;
  }
}

function setSessionCookie(res, token) {
  const secure =
    process.env.NODE_ENV === "production";

  const maxAge =
    SESSION_DAYS * 24 * 60 * 60;

  res.setHeader(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      secure ? "Secure" : "",
      `Max-Age=${maxAge}`
    ]
      .filter(Boolean)
      .join("; ")
  );
}

function clearSessionCookie(res) {
  const secure =
    process.env.NODE_ENV === "production";

  res.setHeader(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=`,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      secure ? "Secure" : "",
      "Max-Age=0"
    ]
      .filter(Boolean)
      .join("; ")
  );
}

async function createSession(userId, res) {
  const token =
    crypto.randomBytes(32).toString("hex");

  const tokenHash = sessionHash(token);

  await pool.query(
    `
      INSERT INTO vira_sessions
      (user_id, token_hash, expires_at)
      VALUES
      ($1, $2, NOW() + INTERVAL '30 days')
    `,
    [userId, tokenHash]
  );

  setSessionCookie(res, token);
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];

  if (!token) return null;

  const result = await pool.query(
    `
      SELECT
        u.id,
        u.email,
        u.created_at
      FROM vira_sessions s
      JOIN vira_users u
        ON u.id = s.user_id
      WHERE
        s.token_hash = $1
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [sessionHash(token)]
  );

  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Authentication required."
      });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error("AUTH ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Authentication error."
    });
  }
}

// Administrative access is controlled by the server environment, never by the browser.
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "");
async function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (!ADMIN_EMAIL || normalizeEmail(req.user.email) !== ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: "Accès administrateur requis." });
    }
    return next();
  });
}

const billing = createTestBilling({ app, pool, requireAdmin });

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vira_users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vira_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL
        REFERENCES vira_users(id)
        ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      vira_sessions_user_id_idx
    ON vira_sessions(user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      vira_sessions_expires_idx
    ON vira_sessions(expires_at)
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS vira_campaigns (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL
        REFERENCES vira_users(id)
        ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Nouvelle campagne',
      status TEXT NOT NULL DEFAULT 'draft',
      campaign_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
      vira_campaigns_user_id_idx
    ON vira_campaigns(user_id)
  `);

  await pool.query(`CREATE TABLE IF NOT EXISTS vira_video_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,
    period_start DATE NOT NULL DEFAULT DATE_TRUNC('month', NOW())::date,
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS vira_video_usage_user_period_idx ON vira_video_usage(user_id, period_start)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS vira_image_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,
    period_start DATE NOT NULL DEFAULT DATE_TRUNC('month', NOW())::date,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS vira_image_usage_user_period_idx ON vira_image_usage(user_id, period_start)`);

  console.log("VIRA database ready");
}

async function reserveImageSlots(userId, quantity = 1) {
  const count = Math.max(1, Math.min(12, Number.parseInt(quantity, 10) || 1));
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(91344, $1::integer)", [userId]);
    const { rows } = await db.query("SELECT COALESCE(SUM(quantity),0)::int AS count FROM vira_image_usage WHERE user_id=$1 AND period_start=DATE_TRUNC('month', NOW())::date", [userId]);
    if (rows[0].count + count > 12) { await db.query("ROLLBACK"); return { ok:false, used: rows[0].count, limit:12 }; }
    await db.query("INSERT INTO vira_image_usage(user_id, quantity) VALUES($1,$2)", [userId, count]);
    await db.query("COMMIT");
    return { ok:true, used: rows[0].count + count, limit:12 };
  } catch (error) { await db.query("ROLLBACK").catch(()=>{}); throw error; }
  finally { db.release(); }
}

async function reserveVideoSlot(userId) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(91343, $1::integer)", [userId]);
    const { rows } = await db.query("SELECT COUNT(*)::int AS count FROM vira_video_usage WHERE user_id=$1 AND period_start=DATE_TRUNC('month', NOW())::date", [userId]);
    if (rows[0].count >= 4) { await db.query("ROLLBACK"); return { ok:false }; }
    const inserted = await db.query("INSERT INTO vira_video_usage(user_id) VALUES($1) RETURNING id", [userId]);
    await db.query("COMMIT");
    return { ok:true, id: inserted.rows[0].id };
  } catch (error) { await db.query("ROLLBACK").catch(()=>{}); throw error; }
  finally { db.release(); }
}

/* ================================
   HEALTH
================================ */

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      service: "VIRA backend",
      database: true
    });

  } catch {
    res.status(503).json({
      ok: false,
      service: "VIRA backend",
      database: false
    });
  }
});

/* ================================
   CREATE ACCOUNT
================================ */

app.post("/api/auth/register", async (req, res) => {
  try {
    const email =
      normalizeEmail(req.body?.email);

    const password =
      String(req.body?.password || "");

    if (
      !email ||
      !email.includes("@") ||
      email.length > 254
    ) {
      return res.status(400).json({
        ok: false,
        error: "Adresse courriel invalide."
      });
    }

    if (
      password.length < 10 ||
      password.length > 128
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Le mot de passe doit contenir au moins 10 caractères."
      });
    }

    const existing = await pool.query(
      `
        SELECT id
        FROM vira_users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

    if (existing.rowCount) {
      return res.status(409).json({
        ok: false,
        error:
          "Un compte existe déjà avec cette adresse."
      });
    }

    const passwordHash =
      await hashPassword(password);

    const result = await pool.query(
      `
        INSERT INTO vira_users
        (email, password_hash)
        VALUES ($1, $2)
        RETURNING id, email, created_at
      `,
      [email, passwordHash]
    );

    const user = result.rows[0];

    await createSession(user.id, res);

    return res.status(201).json({
      ok: true,
      user
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible de créer le compte."
    });
  }
});

/* ================================
   LOGIN
================================ */

app.post("/api/auth/login", async (req, res) => {
  try {
    const email =
      normalizeEmail(req.body?.email);

    const password =
      String(req.body?.password || "");

    const result = await pool.query(
      `
        SELECT
          id,
          email,
          password_hash,
          created_at
        FROM vira_users
        WHERE email = $1
        LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await verifyPassword(
        password,
        user.password_hash
      ))
    ) {
      return res.status(401).json({
        ok: false,
        error:
          "Adresse courriel ou mot de passe incorrect."
      });
    }

    await createSession(user.id, res);

    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible de se connecter."
    });
  }
});

/* ================================
   CURRENT USER
================================ */

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        user: null
      });
    }

    return res.json({
      ok: true,
      user
    });

  } catch (error) {
    console.error("ME ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible de vérifier la session."
    });
  }
});

/* ================================
   LOGOUT
================================ */

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];

    if (token) {
      await pool.query(
        `
          DELETE FROM vira_sessions
          WHERE token_hash = $1
        `,
        [sessionHash(token)]
      );
    }

    clearSessionCookie(res);

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error("LOGOUT ERROR:", error);

    clearSessionCookie(res);

    return res.json({
      ok: true
    });
  }
});



/* ================================
   CAMPAIGNS
================================ */

/* ================================
   ADMIN OVERVIEW
================================ */
app.get("/api/admin/overview", requireAdmin, async (_req, res) => {
  try {
    const [users, campaigns, recentUsers, recentCampaigns] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM vira_users"),
      pool.query("SELECT COUNT(*)::int AS count FROM vira_campaigns"),
      pool.query("SELECT COUNT(*)::int AS count FROM vira_users WHERE created_at >= NOW() - INTERVAL '30 days'"),
      pool.query("SELECT COUNT(*)::int AS count FROM vira_campaigns WHERE created_at >= NOW() - INTERVAL '30 days'")
    ]);
    return res.json({ ok: true, stats: {
      totalUsers: users.rows[0].count,
      totalCampaigns: campaigns.rows[0].count,
      newUsers30d: recentUsers.rows[0].count,
      newCampaigns30d: recentCampaigns.rows[0].count
    }});
  } catch (error) {
    console.error("ADMIN OVERVIEW ERROR:", error);
    return res.status(500).json({ ok: false, error: "Impossible de charger les statistiques." });
  }
});

app.get("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          title,
          status,
          campaign_data,
          created_at,
          updated_at
        FROM vira_campaigns
        WHERE user_id = $1
        ORDER BY updated_at DESC
      `,
      [req.user.id]
    );

    return res.json({
      ok: true,
      campaigns: result.rows
    });

  } catch (error) {
    console.error("CAMPAIGNS LIST ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible de charger les campagnes."
    });
  }
});
app.post("/api/campaigns", requireAuth, async (req, res) => {
  try {
    const title =
      String(req.body?.title || "Nouvelle campagne")
        .trim()
        .slice(0, 160);

    const status =
      String(req.body?.status || "draft")
        .trim()
        .slice(0, 40);

    const campaignData =
      req.body?.campaignData &&
      typeof req.body.campaignData === "object"
        ? req.body.campaignData
        : {};

    const result = await pool.query(
      `
        INSERT INTO vira_campaigns
          (user_id, title, status, campaign_data)
        VALUES
          ($1, $2, $3, $4::jsonb)
        RETURNING
          id,
          title,
          status,
          campaign_data,
          created_at,
          updated_at
      `,
      [
        req.user.id,
        title || "Nouvelle campagne",
        status || "draft",
        JSON.stringify(campaignData)
      ]
    );

    return res.status(201).json({
      ok: true,
      campaign: result.rows[0]
    });

  } catch (error) {
    console.error("CAMPAIGN CREATE ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible d'enregistrer la campagne."
    });
  }
});

app.put("/api/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Campagne invalide."
      });
    }

    const title =
      String(req.body?.title || "Nouvelle campagne")
        .trim()
        .slice(0, 160);

    const status =
      String(req.body?.status || "draft")
        .trim()
        .slice(0, 40);

    const campaignData =
      req.body?.campaignData &&
      typeof req.body.campaignData === "object"
        ? req.body.campaignData
        : {};

    const result = await pool.query(
      `
        UPDATE vira_campaigns
        SET
          title = $1,
          status = $2,
          campaign_data = $3::jsonb,
          updated_at = NOW()
        WHERE id = $4
          AND user_id = $5
        RETURNING
          id,
          title,
          status,
          campaign_data,
          created_at,
          updated_at
      `,
      [
        title || "Nouvelle campagne",
        status || "draft",
        JSON.stringify(campaignData),
        campaignId,
        req.user.id
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        error: "Campagne introuvable."
      });
    }

    return res.json({
      ok: true,
      campaign: result.rows[0]
    });

  } catch (error) {
    console.error("CAMPAIGN UPDATE ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible de mettre à jour la campagne."
    });
  }
});
app.delete("/api/campaigns/:id", requireAuth, async (req, res) => {
  try {
    const campaignId = Number(req.params.id);

    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Campagne invalide."
      });
    }

    const result = await pool.query(
      `
        DELETE FROM vira_campaigns
        WHERE id = $1
          AND user_id = $2
        RETURNING id
      `,
      [campaignId, req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        error: "Campagne introuvable."
      });
    }

    return res.json({
      ok: true,
      deletedId: result.rows[0].id
    });

  } catch (error) {
    console.error("CAMPAIGN DELETE ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Impossible de supprimer la campagne."
    });
  }
});
/* ================================
   START SERVER
================================ */

/* ================================
   VIDEO TEST — AUCUN CRÉDIT
================================ */
/* ================================
   AUDIO TEST — AUCUN CRÉDIT
================================ */

app.post("/api/audio/test", requireAuth, async (req, res) => {
  return res.json({
    ok: true,
    mode: "preview",
    message: "Préparation audio VIRA réussie.",
    audioUrl: null
  });
});
app.post("/api/audio/generate", requireAuth, async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const gender = req.body?.gender;
  if (!text || text.length > 800 || !["male", "female"].includes(gender)) {
    return res.status(400).json({ok:false,error:"Ajoutez une narration de 800 caractères maximum et choisissez une voix."});
  }
  return withAudioJob(req,res,async () => {
    try {return res.json({ok:true,mode:"free",...await synthesizeAudio(text,gender,AUDIO_TEMP_DIR,req.user.id)});}
    catch(error){console.error("VOICE ERROR:",error);return res.status(422).json({ok:false,error:"Impossible de préparer la voix. Essayez un texte plus court (60 secondes maximum)."});}
  });
});
app.post("/api/audio/upload", requireAuth, uploadAudio.single("audio"), async (req,res) => {
  if (!req.file) return res.status(400).json({ok:false,error:"Choisissez ou enregistrez un fichier audio."});
  try {
    return await withAudioJob(req,res,async () => {
      try {return res.json({ok:true,mode:"upload",...await prepareAudio(req.file.path,AUDIO_TEMP_DIR,req.user.id)});}
      catch(error){console.error("AUDIO UPLOAD ERROR:",error);return res.status(422).json({ok:false,error:"Fichier audio invalide ou trop long. Durée maximale : 60 secondes."});}
    });
  } finally {await fs.promises.unlink(req.file.path).catch(()=>{});}
});
app.get("/api/audio/:id", requireAuth, async (req,res) => {
  try {
    const filename=audioFile(AUDIO_TEMP_DIR,req.user.id,req.params.id);
    await fs.promises.access(filename);
    res.setHeader("Cache-Control","private, no-store");
    return res.sendFile(filename);
  } catch {return res.status(404).json({ok:false,error:"Audio introuvable. Préparez à nouveau la narration."});}
});

/* ================================
   VIDEO PREPARE — AUCUN CRÉDIT
================================ */

app.post("/api/video/generate", requireAuth, async (req, res) => {
  const images = req.body?.images;

  if (!Array.isArray(images) || images.length !== 3) {
    return res.status(400).json({
      ok: false,
      error: "VIRA exige exactement 3 visuels."
    });
  }

  const validImages = images.every(image =>
    typeof image === "string" && image.trim().length > 0
  );

  if (!validImages) {
    return res.status(400).json({
      ok: false,
      error: "Chaque scène doit contenir un visuel."
    });
  }

  // Préparation uniquement : aucun appel à Runway ou OpenAI.
  const clips = images.map((image, index) => ({
    scene: index + 1,
    image: image.trim(),
    taskId: null,
    status: "prepared"
  }));

  return res.json({
    ok: true,
    mode: "prepare",
    paidGenerationEnabled: false,
    videoUrl: null,
    clips,
    assembly: {
      format: "mp4",
      sceneOrder: clips.map(clip => clip.scene),
      status: "awaiting_video_clips"
    }
  });
});
// Uploaded clips and generated previews share the same final MP4 contract.
async function publishVideo(clipPaths, prefix, audioPath = null) {
  const result = await assembleVideoClips(clipPaths, audioPath);
  try {
    const filename = `${prefix}-${crypto.randomUUID()}.mp4`;
    await fs.promises.copyFile(result.outputPath, path.join(VIDEO_TEMP_DIR, filename));
    return `/videos/${filename}`;
  } finally {
    await result.cleanup();
  }
}

app.post(
  "/api/video/assemble",
  requireAuth,
  uploadVideoClips.array("clips", 3),
  async (req, res) => {
    const files = req.files || [];
    try {
      if (files.length !== 3) {
        return res.status(400).json({ ok: false, error: "VIRA exige exactement 3 clips vidéo." });
      }
      const videoUrl = await publishVideo(files.map(file => path.resolve(file.path)), "vira-final");
      return res.json({ ok: true, videoUrl });
    } catch (error) {
      console.error("VIDEO ASSEMBLY ERROR:", error);
      return res.status(500).json({ ok: false, error: "Impossible d’assembler les clips vidéo." });
    } finally {
      await Promise.allSettled(files.map(file => fs.promises.unlink(file.path)));
    }
  }
);

function decodePreviewImage(source, index) {
  // The new index.html sends raster JPEGs, avoiding SVG decoder dependencies.
  const match = typeof source === "string" && source.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error(`Visuel ${index + 1} invalide : utilisez une image JPEG ou PNG.`);
  const buffer = Buffer.from(match[2], "base64");
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (!buffer.length || buffer.length > 1024 * 1024 || (match[1] === "jpeg" ? !jpeg : !png)) {
    throw new Error(`Visuel ${index + 1} vide, trop volumineux ou invalide.`);
  }
  return { buffer, extension: match[1] === "jpeg" ? "jpg" : "png" };
}

function createPreviewClip(imagePath, clipPath, duration = 2) {
  return new Promise((resolve, reject) => {
    ffmpeg(imagePath, { timeout: 40 })
      .inputOptions(["-loop", "1"])
      .duration(duration)
      .videoCodec("libx264")
      .format("mp4")
      .outputOptions([
        "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-an",
        "-preset", "veryfast",
        "-threads", "2",
        "-movflags", "+faststart"
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(clipPath);
  });
}

app.post("/api/video/free-assemble", requireAuth, async (req, res) => {
  console.log("FREE-ASSEMBLE ROUTE REACHED");
  const images = req.body?.images;
  if (!Array.isArray(images) || images.length !== 3) {
    return res.status(400).json({ ok: false, error: "VIRA exige exactement 3 visuels JPEG ou PNG." });
  }
  const usage = await reserveVideoSlot(req.user.id);
  if (!usage.ok) return res.status(429).json({ ok:false, error:"Limite atteinte : 4 vidéos maximum par mois avec VIRA Starter." });
  let decoded;
  try {
    decoded = images.map(decodePreviewImage);
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }

  let audioPath = null, duration = 6;
  if (req.body?.audioId) {
    try { audioPath = audioFile(AUDIO_TEMP_DIR, req.user.id, req.body.audioId); duration = await wavDuration(audioPath); }
    catch { return res.status(400).json({ok:false,error:"La narration a expiré ou est invalide. Préparez-la de nouveau."}); }
  }
  const temporaryFiles = [];
  try {
    const jobId = crypto.randomUUID();
    const clips = [];
    for (let i = 0; i < decoded.length; i++) {
      const imagePath = path.join(VIDEO_TEMP_DIR, `vira-image-${jobId}-${i}.${decoded[i].extension}`);
      const clipPath = path.join(VIDEO_TEMP_DIR, `vira-clip-${jobId}-${i}.mp4`);
      temporaryFiles.push(imagePath, clipPath);
      await fs.promises.writeFile(imagePath, decoded[i].buffer);
      // Keep the input until FFmpeg has actually finished reading it.
      await createPreviewClip(imagePath, clipPath, Math.max(2,duration)/3);
      clips.push(clipPath);
    }
    console.log("FREE-ASSEMBLE clips ready:", clips.length);
console.log("FREE-ASSEMBLE before publishVideo");
    const videoUrl = await publishVideo(clips, "vira-free-final", audioPath);
    await pool.query("UPDATE vira_video_usage SET status='completed' WHERE id=$1", [usage.id]);
    return res.json({ ok: true, mode: "free", videoUrl, hasAudio: Boolean(audioPath), duration: Math.max(2,duration), quota: { limit: 4 } });
  } catch (error) {
    await pool.query("DELETE FROM vira_video_usage WHERE id=$1", [usage.id]).catch(()=>{});
    console.error("FREE VIDEO ASSEMBLY ERROR:", error);
    return res.status(500).json({ ok: false, error: "Impossible de créer la vidéo gratuite. Réessayez dans un instant." });
  } finally {
    await Promise.allSettled(temporaryFiles.map(file => fs.promises.unlink(file)));
  }
});

// Reserve image-generation units before any paid AI image request.
app.post("/api/images/reserve", requireAuth, async (req, res) => {
  try {
    const result = await reserveImageSlots(req.user.id, req.body?.quantity);
    if (!result.ok) return res.status(429).json({ ok:false, error:"Limite atteinte : 12 images IA maximum par mois avec VIRA Starter.", ...result });
    res.json(result);
  } catch (error) {
    console.error("image usage reservation error", error);
    res.status(500).json({ ok:false, error:"Impossible de vérifier la limite d’images." });
  }
});
app.post("/api/video/test", requireAuth, async (req, res) => {
  const assemblerReady = typeof assembleVideoClips === "function";
  return res.json({
    ok: true,
    mode: "preview",
    assemblerReady,
    message: "Préparation vidéo VIRA réussie.",
    videoUrl: null
  });
});


// Keep API errors JSON, including malformed JSON and oversized uploads.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("REQUEST ERROR:", error);
  const status = error.type === "entity.too.large" ? 413
    : error instanceof multer.MulterError || error.type === "entity.parse.failed" ? 400 : 500;
  return res.status(status).json({
    ok: false,
    error: status === 413 ? "Les fichiers dépassent la taille acceptée."
      : status === 400 ? "Requête ou fichiers invalides."
      : "Une erreur serveur est survenue."
  });
});

async function start() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not configured."
      );
    }

    await initDatabase();
    await billing.init();

    app.listen(port, "0.0.0.0", () => {
      console.log(
        `VIRA backend running on port ${port}`
      );
    });

  } catch (error) {
    console.error(
      "VIRA STARTUP ERROR:",
      error
    );

    process.exit(1);
  }
}

start();
