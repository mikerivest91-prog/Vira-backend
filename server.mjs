import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const { Pool } = pg;
const scrypt = promisify(crypto.scrypt);

const app = express();
const port = Number(process.env.PORT || 10000);

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.static("."));

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
        cookies[key] = decodeURIComponent(value);
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

  console.log("VIRA database ready");
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
   PROTECTED TEST
================================ */

app.get(
  "/api/private-test",
  requireAuth,
  (req, res) => {
    res.json({
      ok: true,
      message: "VIRA secure session active.",
      user: req.user
    });
  }
);

/* ================================
   START SERVER
================================ */

async function start() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not configured."
      );
    }

    await initDatabase();

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
