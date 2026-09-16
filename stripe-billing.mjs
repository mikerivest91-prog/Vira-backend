import Stripe from "stripe";
import { fileURLToPath } from "node:url";

// This integration intentionally supports test mode only. It grants no paid credits.
export function createTestBilling({ app, pool, requireAdmin, env = process.env, client }) {
  const origin = "https://vira-backend-im5s.onrender.com";
  const key = env.STRIPE_SECRET_KEY || "";
  const priceId = env.STRIPE_PRICE_ID || "";
  const secret = env.STRIPE_WEBHOOK_SECRET || "";
  const enabled = key.startsWith("sk_test_") && priceId.startsWith("price_") && secret.startsWith("whsec_");
  const stripe = client || (key.startsWith("sk_test_") ? new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 }) : null);
  const fail = (res, status, message) => res.status(status).json({ ok: false, error: message });
  const route = fn => async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!enabled) return fail(res, 503, "Configuration Stripe de test incomplète : vérifiez les trois variables Stripe.");
    if (req.method === "POST" && req.headers.origin !== origin) return fail(res, 403, "Origine de la demande invalide.");
    try { await fn(req, res); }
    catch { return fail(res, 502, "Stripe est indisponible ou sa configuration est incomplète. Réessayez après vérification."); }
  };
  async function locked(userId, work) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(91342, $1::integer)", [userId]);
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  }
  async function price() {
    const p = await stripe.prices.retrieve(priceId);
    if (p.livemode || !p.active || p.type !== "recurring" || p.currency !== "cad" || p.unit_amount !== 1000 || p.recurring?.interval !== "month" || p.recurring?.interval_count !== 1) throw new Error("Unexpected test price");
    return p;
  }
  async function subscriptions(customer) {
    const result = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
    if (result.has_more || result.data.some(s => s.livemode)) throw new Error("Unexpected subscriptions");
    return result.data.filter(s => s.items.data.some(i => i.price.id === priceId));
  }
  async function sync(db, customer) {
    const list = await subscriptions(customer);
    const snapshot = list.map(s => ({ id: s.id, status: s.status, cancel_at_period_end: s.cancel_at_period_end }));
    await db.query("UPDATE vira_test_billing SET subscriptions=$2::jsonb, updated_at=NOW() WHERE customer_id=$1", [customer, JSON.stringify(snapshot)]);
    return snapshot;
  }
  app.get("/api/billing/status", requireAdmin, route(async (req, res) => {
    await price();
    const result = await locked(req.user.id, async db => {
      const { rows } = await db.query("SELECT customer_id FROM vira_test_billing WHERE user_id=$1", [req.user.id]);
      return rows[0] ? sync(db, rows[0].customer_id) : [];
    });
    res.json({ ok: true, mode: "test", subscriptions: result });
  }));
  app.post("/api/billing/checkout", requireAdmin, route(async (req, res) => {
    await price();
    const url = await locked(req.user.id, async db => {
      let { rows: [row] } = await db.query("SELECT * FROM vira_test_billing WHERE user_id=$1", [req.user.id]);
      if (!row) {
        const customer = await stripe.customers.create({ metadata: { vira_user_id: String(req.user.id) } }, { idempotencyKey: `vira-test-customer-${req.user.id}` });
        if (customer.livemode) throw new Error("Live customer rejected");
        const inserted = await db.query("INSERT INTO vira_test_billing(user_id,customer_id) VALUES($1,$2) RETURNING *", [req.user.id, customer.id]);
        row = inserted.rows[0];
      }
      const subs = await sync(db, row.customer_id);
      if (subs.some(s => !["canceled", "incomplete_expired"].includes(s.status))) return null;
      if (row.checkout_id) {
        const existing = await stripe.checkout.sessions.retrieve(row.checkout_id);
        if (existing.status === "open" && !existing.livemode) return existing.url;
        if (existing.status === "complete") {
          const refreshed = await sync(db, row.customer_id);
          if (refreshed.some(s => !["canceled", "incomplete_expired"].includes(s.status))) return null;
        }
      }
      // Persisted attempt counter plus idempotency handles concurrent requests and network retries.
      const attempt = Number(row.attempt) + 1;
      const session = await stripe.checkout.sessions.create({
        mode: "subscription", customer: row.customer_id,
        client_reference_id: String(req.user.id),
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { vira_user_id: String(req.user.id) } },
        success_url: `${origin}/abonnement-test?result=success`,
        cancel_url: `${origin}/abonnement-test?result=cancel`,
      }, { idempotencyKey: `vira-test-checkout-${req.user.id}-${attempt}` });
      if (session.livemode || !session.url?.startsWith("https://checkout.stripe.com/")) throw new Error("Invalid checkout");
      await db.query("UPDATE vira_test_billing SET checkout_id=$2,attempt=$3 WHERE user_id=$1", [req.user.id, session.id, attempt]);
      return session.url;
    });
    if (!url) return fail(res, 409, "Un abonnement existe déjà. Utilisez Gérer mon abonnement.");
    res.json({ ok: true, url });
  }));
  app.post("/api/billing/portal", requireAdmin, route(async (req, res) => {
    const { rows } = await pool.query("SELECT customer_id FROM vira_test_billing WHERE user_id=$1", [req.user.id]);
    if (!rows[0]) return fail(res, 409, "Créez d’abord un abonnement de test.");
    const session = await stripe.billingPortal.sessions.create({ customer: rows[0].customer_id, return_url: `${origin}/abonnement-test` });
    res.json({ ok: true, url: session.url });
  }));
  app.get("/abonnement-test", requireAdmin, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(fileURLToPath(new URL("./abonnement-test.html", import.meta.url)));
  });
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS vira_test_billing (
        user_id BIGINT PRIMARY KEY REFERENCES vira_users(id) ON DELETE CASCADE,
        customer_id TEXT UNIQUE NOT NULL, checkout_id TEXT, attempt INTEGER NOT NULL DEFAULT 0,
        subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    },
    async webhook(req, res) {
      if (!enabled) return fail(res, 503, "Test billing unavailable");
      let event;
      try { event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret); }
      catch { return fail(res, 400, "Invalid signature"); }
      if (event.livemode) return fail(res, 400, "Test events only");
      if (!["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"].includes(event.type)) return res.json({ received: true });
      const customer = event.data.object.customer;
      if (typeof customer !== "string") return res.json({ received: true });
      try {
        const { rows } = await pool.query("SELECT user_id FROM vira_test_billing WHERE customer_id=$1", [customer]);
        // Fetch current Stripe state under the same lock: duplicates and delayed events cannot regress it.
        if (rows[0]) await locked(rows[0].user_id, db => sync(db, customer));
        return res.json({ received: true });
      } catch { return fail(res, 500, "Retry event later"); }
    }
  };
}
