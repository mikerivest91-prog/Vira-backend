// Every caller runs inside a transaction and holds the per-user advisory lock.
export const creditSchema=`
CREATE TABLE IF NOT EXISTS olyvex_animation_usage(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS olyvex_credit_grants (
 id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,
 mode TEXT NOT NULL CHECK(mode IN ('test','live')),resource TEXT NOT NULL CHECK(resource IN ('videos','images','animations')),
 source TEXT NOT NULL,units INTEGER NOT NULL CHECK(units>0),remaining INTEGER NOT NULL CHECK(remaining>=0 AND remaining<=units),
 expires_at TIMESTAMPTZ,payment_intent TEXT,revoked BOOLEAN NOT NULL DEFAULT false,
 UNIQUE(mode,source,resource)
);
CREATE INDEX IF NOT EXISTS olyvex_credit_owner ON olyvex_credit_grants(user_id,mode,resource);
CREATE TABLE IF NOT EXISTS olyvex_credit_spend (
 grant_id BIGINT NOT NULL REFERENCES olyvex_credit_grants(id) ON DELETE CASCADE,usage_kind TEXT NOT NULL CHECK(usage_kind IN ('videos','images','animations')),
 usage_id BIGINT NOT NULL,units INTEGER NOT NULL CHECK(units>0),refunded BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY(grant_id,usage_kind,usage_id)
);
CREATE OR REPLACE FUNCTION olyvex_refund_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind TEXT := TG_ARGV[0];
BEGIN
 PERFORM pg_advisory_xact_lock(91350,OLD.user_id::integer);
 WITH refunds AS (
   UPDATE olyvex_credit_spend SET refunded=true WHERE usage_kind=kind AND usage_id=OLD.id AND NOT refunded RETURNING grant_id,units
 ) UPDATE olyvex_credit_grants g SET remaining=LEAST(g.units,g.remaining+r.units) FROM refunds r WHERE g.id=r.grant_id;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS olyvex_video_refund ON vira_video_usage;
CREATE TRIGGER olyvex_video_refund BEFORE DELETE ON vira_video_usage FOR EACH ROW EXECUTE FUNCTION olyvex_refund_usage('videos');
DROP TRIGGER IF EXISTS olyvex_image_refund ON vira_image_usage;
CREATE TRIGGER olyvex_image_refund BEFORE DELETE ON vira_image_usage FOR EACH ROW EXECUTE FUNCTION olyvex_refund_usage('images');
DROP TRIGGER IF EXISTS olyvex_animation_refund ON olyvex_animation_usage;
CREATE TRIGGER olyvex_animation_refund BEFORE DELETE ON olyvex_animation_usage FOR EACH ROW EXECUTE FUNCTION olyvex_refund_usage('animations');
`;
export async function creditLock(db,userId){await db.query('SELECT pg_advisory_xact_lock(91350,$1::integer)',[userId]);}
export async function grantCredits(db,{userId,mode,offer,source,expiresAt=null,paymentIntent=null}){
 for(const resource of ['videos','images','animations']){
  const units=offer[resource];if(!units)continue;
  const result=await db.query(`INSERT INTO olyvex_credit_grants(user_id,mode,resource,source,units,remaining,expires_at,payment_intent)
    VALUES($1,$2,$3,$4,$5,$5,$6,$7) ON CONFLICT(mode,source,resource) DO NOTHING RETURNING id`,[userId,mode,resource,source,units,expiresAt,paymentIntent]);
  if(!result.rows.length){const {rows}=await db.query('SELECT user_id,units FROM olyvex_credit_grants WHERE mode=$1 AND source=$2 AND resource=$3',[mode,source,resource]);
   if(String(rows[0]?.user_id)!==String(userId)||rows[0]?.units!==units)throw Error('Attribution de crédits incohérente.');}
 }
}
export async function creditBalance(db,userId,mode){
 const {rows}=await db.query(`SELECT resource,COALESCE(SUM(remaining) FILTER(WHERE expires_at IS NOT NULL),0)::int AS monthly,
   COALESCE(SUM(remaining) FILTER(WHERE expires_at IS NULL),0)::int AS packs, SUM(units)::int AS allocated FROM olyvex_credit_grants
   WHERE user_id=$1 AND mode=$2 AND NOT revoked AND (expires_at IS NULL OR expires_at>NOW()) GROUP BY resource`,[userId,mode]);
 return Object.fromEntries(['videos','images','animations'].map(resource=>{const row=rows.find(r=>r.resource===resource);const monthly=row?.monthly||0,packs=row?.packs||0;return [resource,{monthly,packs,remaining:monthly+packs,allocated:row?.allocated||0}];}));
}
export async function consumeCredits(db,{userId,mode,resource,usageId,quantity}){
 if(!['videos','images','animations'].includes(resource)||!Number.isSafeInteger(quantity)||quantity<1)throw Error('Consommation invalide.');
 const prior=await db.query(`SELECT s.units,s.refunded FROM olyvex_credit_spend s JOIN olyvex_credit_grants g ON g.id=s.grant_id
   WHERE s.usage_kind=$1 AND s.usage_id=$2 AND g.user_id=$3 AND g.mode=$4`,[resource,usageId,userId,mode]);
 if(prior.rows.length){if(prior.rows.some(r=>r.refunded)||prior.rows.reduce((sum,r)=>sum+r.units,0)!==quantity)throw Error('Réservation de crédits incompatible.');return true;}
 const {rows}=await db.query(`SELECT id,remaining FROM olyvex_credit_grants WHERE user_id=$1 AND mode=$2 AND resource=$3
  AND NOT revoked AND remaining>0 AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY expires_at ASC NULLS LAST,id FOR UPDATE`,[userId,mode,resource]);
 if(rows.reduce((sum,row)=>sum+row.remaining,0)<quantity)return false;
 let needed=quantity;
 for(const row of rows){const units=Math.min(needed,row.remaining);if(!units)break;
  await db.query('UPDATE olyvex_credit_grants SET remaining=remaining-$2 WHERE id=$1',[row.id,units]);
  await db.query('INSERT INTO olyvex_credit_spend(grant_id,usage_kind,usage_id,units) VALUES($1,$2,$3,$4)',[row.id,resource,usageId,units]);needed-=units;
 }
 return true;
}
