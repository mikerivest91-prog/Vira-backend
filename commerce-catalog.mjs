export const offers=Object.freeze([
  {id:'starter',name:'Starter',kind:'subscription',amount:2999,videos:4,images:16,animations:0},
  {id:'growth',name:'Croissance',kind:'subscription',amount:7999,videos:12,images:48,animations:0},
  {id:'pro',name:'Pro',kind:'subscription',amount:14999,videos:24,images:96,animations:0},
  {id:'video_pack',name:'Bloc vidéo',kind:'payment',amount:2499,videos:4,images:0,animations:0},
  {id:'image_pack',name:'Bloc images IA',kind:'payment',amount:999,videos:0,images:16,animations:0},
  {id:'animation_pack',name:'Bloc animation',kind:'payment',amount:999,videos:0,images:0,animations:4}
].map(offer=>Object.freeze({...offer,currency:'cad'})));
export function catalog(env={}) {
  return offers.map(offer=>({...offer,priceId:env['STRIPE_PRICE_'+offer.id.toUpperCase()] || (offer.id==='starter'?env.STRIPE_PRICE_ID:'') || ''}));
}
export function validatePrice(price,offer,live) {
  if(price.livemode!==live || !price.active || price.currency!==offer.currency || price.unit_amount!==offer.amount ||
    price.type!==(offer.kind==='subscription'?'recurring':'one_time') ||
    (offer.kind==='subscription'&&(price.recurring?.interval!=='month'||price.recurring.interval_count!==1)))throw Error('Tarif Stripe incompatible.');
}
