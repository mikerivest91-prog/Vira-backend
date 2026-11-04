import Stripe from 'stripe';
import {fileURLToPath} from 'node:url';
import {catalog,validatePrice} from './commerce-catalog.mjs';
import {creditSchema,creditLock,creditBalance,grantCredits,consumeCredits} from './credit-bank.mjs';

const objectId=value=>typeof value==='string'?value:value?.id;
export function createCommerce({app,pool,requireAuth,env=process.env,client}){
 const mode=env.STRIPE_MODE==='live'?'live':'test',live=mode==='live';
 const key=env.STRIPE_SECRET_KEY||'',secret=env.COMMERCE_WEBHOOK_SECRET||'';
 const configured=key.startsWith(live?'sk_live_':'sk_test_')&&secret.startsWith('whsec_')&&Boolean(env.STRIPE_PORTAL_CONFIGURATION?.startsWith('bpc_'));
 const enabled=env.OLYVEX_COMMERCE_ENABLED==='true';
 const testers=new Set((env.BILLING_TEST_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
 const applies=user=>enabled&&(live||testers.has(String(user?.email||'').toLowerCase()));
 const stripe=client||(configured?new Stripe(key,{maxNetworkRetries:2,timeout:20000}):null);
 const origin=(env.APP_ORIGIN||'https://vira-backend-im5s.onrender.com').replace(/\/$/,'');
 const items=catalog(env),byPrice=id=>items.find(o=>o.priceId===id&&id);
 const animationEnabled=env.RUNWAY_CLIENTS_ENABLED==='true'&&Boolean(env.RUNWAYML_API_SECRET);
 const imageEnabled=user=>env.AI_IMAGES_ENABLED==='true'&&Boolean(env.OPENAI_API_KEY)&&(env.AI_IMAGES_ALLOW_CLIENTS==='true'||[env.ADMIN_EMAIL,...(env.AI_IMAGE_TEST_EMAILS||'').split(',')].some(email=>email?.trim().toLowerCase()===String(user?.email||'').toLowerCase()));
 const sellable=(offer,user)=>offer.id==='animation_pack'?animationEnabled:!offer.images||imageEnabled(user);
 const fail=(res,status,error)=>res.status(status).json({ok:false,error});
 async function locked(userId,fn){const db=await pool.connect();try{await db.query('BEGIN');await creditLock(db,userId);const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}}
 async function readSubscriptions(customer){const result=await stripe.subscriptions.list({customer,status:'all',limit:100});
  if(result.has_more||result.data.some(s=>s.livemode!==live))throw Error('Abonnements incompatibles.');return result.data.filter(s=>s.items.data.some(i=>byPrice(i.price.id)?.kind==='subscription'));}
 async function sync(db,userId,customer){
  const subscriptions=await readSubscriptions(customer),now=Date.now()/1000;
  const active=subscriptions.filter(s=>s.status==='active'&&(!s.cancel_at||s.cancel_at>now)&&s.items.data.some(i=>i.current_period_end>now));
  if(active.length>1)throw Error('Plusieurs abonnements actifs.');
  let current=null;
  if(active[0]){
   const s=active[0],line=s.items.data.find(i=>byPrice(i.price.id)?.kind==='subscription'),offer=byPrice(line.price.id);
   await checkedPrice(offer);
   if(line.quantity!==1)throw Error('Quantité abonnement incompatible.');
   const invoice=await stripe.invoices.retrieve(objectId(s.latest_invoice));
   const invoiceSub=objectId(invoice.parent?.subscription_details?.subscription||invoice.subscription);
   if(invoice.livemode!==live||objectId(invoice.customer)!==customer||invoiceSub!==s.id||invoice.status!=='paid'||invoice.amount_remaining!==0||!['subscription_create','subscription_cycle'].includes(invoice.billing_reason))throw Error('Facture de période non confirmée.');
   if(!Number.isFinite(line.current_period_start)||line.current_period_start>now||!Number.isFinite(line.current_period_end)||line.current_period_end<=now)throw Error('Période incompatible.');
   const paidLine=invoice.lines?.data?.find(l=>objectId(l.pricing?.price_details?.price||l.price)===offer.priceId&&l.period?.start===line.current_period_start&&l.period?.end===line.current_period_end&&l.quantity===1);
   if(!paidLine||invoice.lines.has_more)throw Error('Ligne de facture incompatible.');
   await grantCredits(db,{userId,mode,offer,source:`period:${s.id}:${line.current_period_start}`,expiresAt:new Date(line.current_period_end*1000)});
   current={id:s.id,plan:offer.id,name:offer.name,periodEnd:line.current_period_end,cancelAt:s.cancel_at||(s.cancel_at_period_end?line.current_period_end:null)};
  }
  await db.query('UPDATE olyvex_commerce_customers SET subscription=$3::jsonb,updated_at=NOW() WHERE user_id=$1 AND mode=$2',[userId,mode,JSON.stringify(current)]);
  return {current,subscriptions};
 }
 async function checkedPrice(offer){if(!offer?.priceId||!/^price_[A-Za-z0-9]+$/.test(offer.priceId))throw Error('Tarif non configuré.');const price=await stripe.prices.retrieve(offer.priceId);validatePrice(price,offer,live);return price;}
 async function checkedPortal(){const configuration=env.STRIPE_PORTAL_CONFIGURATION;if(!configuration)throw Error('Portail non configuré.');const config=await stripe.billingPortal.configurations.retrieve(configuration);if(config.livemode!==live||!config.active||config.features?.subscription_update?.enabled||!config.features?.subscription_cancel?.enabled||config.features.subscription_cancel.mode!=='at_period_end')throw Error('Configuration portail incompatible.');return configuration;}
 async function status(user){return locked(user.id,async db=>{const row=(await db.query('SELECT * FROM olyvex_commerce_customers WHERE user_id=$1 AND mode=$2',[user.id,mode])).rows[0];const state=row&&!row.suspended?await sync(db,user.id,row.customer_id):{current:null,subscriptions:[]};return {...state,canManage:Boolean(row),suspended:Boolean(row?.suspended),balance:await creditBalance(db,user.id,mode)};});}
 const route=fn=>async(req,res)=>{res.setHeader('Cache-Control','private, no-store');if(!applies(req.user)||!configured)return fail(res,503,'Les paiements de cette boutique ne sont pas encore activés pour ce compte.');if(req.method==='POST'&&req.headers.origin!==origin)return fail(res,403,'Origine invalide.');try{await fn(req,res);}catch{return fail(res,503,'Vérification Stripe indisponible. Aucun crédit supplémentaire n’a été attribué.');}};
 app.get('/abonnements',requireAuth,(_req,res)=>{res.setHeader('Cache-Control','private, no-store');res.sendFile(fileURLToPath(new URL('./abonnements.html',import.meta.url)));});
 app.get('/commerce-ui.mjs',requireAuth,(_req,res)=>res.sendFile(fileURLToPath(new URL('./commerce-ui.mjs',import.meta.url))));
 app.get('/api/commerce/catalog',requireAuth,(req,res)=>res.setHeader('Cache-Control','private, no-store').json({ok:true,mode,enabled:applies(req.user)&&configured,offers:items.map(({priceId,...offer})=>({...offer,available:applies(req.user)&&configured&&Boolean(priceId)&&sellable(offer,req.user)}))}));
 app.get('/api/commerce/status',requireAuth,route(async(req,res)=>{const s=await status(req.user);res.json({ok:true,mode,current:s.current,canManage:s.canManage,suspended:s.suspended,balance:s.balance});}));
 app.post('/api/commerce/checkout',requireAuth,route(async(req,res)=>{
  const offer=items.find(o=>o.id===req.body?.offer);
  if(!offer||!sellable(offer,req.user))return fail(res,400,'Offre indisponible.');
  await checkedPortal();await checkedPrice(offer);
  const url=await locked(req.user.id,async db=>{
   let row=(await db.query('SELECT * FROM olyvex_commerce_customers WHERE user_id=$1 AND mode=$2',[req.user.id,mode])).rows[0];
   if(!row){const customer=await stripe.customers.create({metadata:{olyvex_user_id:String(req.user.id),olyvex_mode:mode}},{idempotencyKey:`olyvex-${mode}-customer-${req.user.id}`});if(customer.livemode!==live)throw Error('Client incompatible.');row=(await db.query('INSERT INTO olyvex_commerce_customers(user_id,mode,customer_id) VALUES($1,$2,$3) RETURNING *',[req.user.id,mode,customer.id])).rows[0];}
   if(row.suspended)throw Error('Compte à vérifier.');
   const s=await sync(db,req.user.id,row.customer_id);
   if(offer.kind==='subscription'&&s.subscriptions.some(s=>!['canceled','incomplete_expired'].includes(s.status)))return null;
   if(offer.kind==='payment'&&!s.current)return null;
   if(row.checkout_id){const previous=await stripe.checkout.sessions.retrieve(row.checkout_id);if(previous.livemode!==live)throw Error('Session incompatible.');if(previous.status==='open'){if(previous.metadata?.olyvex_offer===offer.id)return previous.url;return null;}}
   const attempt=Number(row.attempt)+1;
   const metadata={olyvex_user_id:String(req.user.id),olyvex_offer:offer.id,olyvex_mode:mode};
   const session=await stripe.checkout.sessions.create({mode:offer.kind,customer:row.customer_id,client_reference_id:String(req.user.id),metadata,
    line_items:[{price:offer.priceId,quantity:1}],...(offer.kind==='subscription'?{subscription_data:{metadata}}:{payment_intent_data:{metadata}}),
    success_url:`${origin}/abonnements?result=success`,cancel_url:`${origin}/abonnements?result=cancel`},{idempotencyKey:`olyvex-${mode}-${req.user.id}-checkout-${attempt}`});
   if(session.livemode!==live||!session.url?.startsWith('https://checkout.stripe.com/'))throw Error('Session incompatible.');
   await db.query('UPDATE olyvex_commerce_customers SET checkout_id=$3,attempt=$4 WHERE user_id=$1 AND mode=$2',[req.user.id,mode,session.id,attempt]);return session.url;
  });
  if(!url)return fail(res,409,'Un abonnement actif ou un paiement en cours empêche cet achat. Gérez votre abonnement ou terminez le paiement en cours.');
  return res.json({ok:true,url});
 }));
 app.post('/api/commerce/portal',requireAuth,route(async(req,res)=>{
  const row=(await pool.query('SELECT customer_id FROM olyvex_commerce_customers WHERE user_id=$1 AND mode=$2',[req.user.id,mode])).rows[0];
  if(!row)return fail(res,409,'Aucun abonnement à gérer.');
  // This dedicated portal must allow cancellation/payment-method changes only.
  const configuration=await checkedPortal();
  const session=await stripe.billingPortal.sessions.create({customer:row.customer_id,configuration,return_url:`${origin}/abonnements`});
  res.json({ok:true,url:session.url});
 }));
 async function fulfillSession(db,userId,sessionId,customer){
  const session=await stripe.checkout.sessions.retrieve(sessionId,{expand:['line_items','payment_intent']});
  if(session.livemode!==live||objectId(session.customer)!==customer||session.client_reference_id!==String(userId)||session.metadata?.olyvex_mode!==mode||session.status!=='complete')throw Error('Session incompatible.');
  if(session.mode==='subscription'){await sync(db,userId,customer);return;}
  if(session.payment_status!=='paid')return;
  const offer=items.find(o=>o.id===session.metadata?.olyvex_offer),lines=session.line_items;
  if(!offer||offer.kind!=='payment'||lines?.has_more||lines?.data?.length!==1||lines.data[0].price?.id!==offer.priceId||lines.data[0].quantity!==1||session.amount_total!==offer.amount||session.currency!=='cad')throw Error('Achat incompatible.');
  await checkedPrice(offer);
  const intent=typeof session.payment_intent==='object'?session.payment_intent:await stripe.paymentIntents.retrieve(session.payment_intent);
  if(intent.status!=='succeeded'||intent.livemode!==live||objectId(intent.customer)!==customer||intent.amount_received!==offer.amount)throw Error('Paiement non confirmé.');
  const charges=await stripe.charges.list({payment_intent:intent.id,limit:10});if(charges.has_more||charges.data.some(c=>c.refunded||c.amount_refunded>0||c.disputed))throw Error('Paiement remboursé ou contesté.');
  await grantCredits(db,{userId,mode,offer,source:`checkout:${session.id}`,paymentIntent:intent.id});
 }
 return {enabled,applies,mode,animationEnabled,
  async init(){await pool.query(creditSchema);await pool.query(`CREATE TABLE IF NOT EXISTS olyvex_commerce_customers(user_id BIGINT NOT NULL REFERENCES vira_users(id) ON DELETE CASCADE,mode TEXT NOT NULL CHECK(mode IN ('test','live')),customer_id TEXT NOT NULL UNIQUE,checkout_id TEXT,attempt INTEGER NOT NULL DEFAULT 0,subscription JSONB,suspended BOOLEAN NOT NULL DEFAULT false,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,mode))`);},
  async requireCreation(req,res,next){if(!applies(req.user))return next();try{if(!configured)throw Error();const s=await status(req.user);if(!s.current)return fail(res,403,'Un abonnement actif et payé est nécessaire. Consultez vos abonnements.');return next();}catch{return fail(res,503,'Impossible de vérifier votre abonnement. Réessayez.');}},
  async consume(db,userId,resource,usageId,quantity){await creditLock(db,userId);return consumeCredits(db,{userId,mode,resource,usageId,quantity});},
  async reserve(user,resource,quantity){return locked(user.id,async db=>{
   const available=(await creditBalance(db,user.id,mode))[resource].remaining;if(available<quantity)return {ok:false,limit:available,error:'Crédits insuffisants. Consultez vos forfaits et blocs.'};
   const inserted=resource==='videos'?await db.query('INSERT INTO vira_video_usage(user_id) VALUES($1) RETURNING id',[user.id]):resource==='animations'?await db.query('INSERT INTO olyvex_animation_usage(user_id) VALUES($1) RETURNING id',[user.id]):await db.query('INSERT INTO vira_image_usage(user_id,quantity) VALUES($1,$2) RETURNING id',[user.id,quantity]);
   const id=inserted.rows[0].id;if(!await consumeCredits(db,{userId:user.id,mode,resource,usageId:id,quantity}))throw Error('Crédits insuffisants.');
   return {ok:true,id,limit:available,used:quantity,ownerTesting:false};
  });},
  async usage(user){const s=await status(user);return Object.fromEntries(['videos','images','animations'].map(k=>[k,{...s.balance[k],limit:s.balance[k].allocated,ownerTesting:false}]));},
  async webhook(req,res){if(!enabled||!configured)return fail(res,503,'Boutique indisponible.');let event;
   try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],secret);}catch{return fail(res,400,'Signature invalide.');}
   if(event.livemode!==live)return fail(res,400,'Mode incompatible.');
   if(!['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','charge.refunded','charge.dispute.created'].includes(event.type))return res.json({received:true});
   try{
    let object=event.data.object;let customer=objectId(object.customer);
    if(event.type==='charge.dispute.created'){object=await stripe.charges.retrieve(objectId(object.charge));customer=objectId(object.customer);}
    if(!customer)return res.json({received:true});
    const row=(await pool.query('SELECT user_id FROM olyvex_commerce_customers WHERE customer_id=$1 AND mode=$2',[customer,mode])).rows[0];
    if(row)await locked(row.user_id,async db=>{
     if(event.type.startsWith('charge.')){const charge=await stripe.charges.retrieve(objectId(object));if(charge.livemode!==live||objectId(charge.customer)!==customer)throw Error();
      if(charge.amount_refunded>0||charge.disputed){
       await db.query('UPDATE olyvex_credit_grants SET revoked=true WHERE user_id=$1 AND mode=$2',[row.user_id,mode]);
       await db.query('UPDATE olyvex_commerce_customers SET suspended=true WHERE user_id=$1 AND mode=$2',[row.user_id,mode]);
      }
     }else if(event.type.startsWith('checkout.'))await fulfillSession(db,row.user_id,object.id,customer);
     else await sync(db,row.user_id,customer);
    });
    return res.json({received:true});
   }catch{return fail(res,500,'Réessayer ultérieurement.');}
  }
 };
}
