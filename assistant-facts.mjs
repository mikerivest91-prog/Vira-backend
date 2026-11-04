import {offers} from './commerce-catalog.mjs';
import {creditBalance} from './credit-bank.mjs';
import {assistantLinks} from './assistant-knowledge.mjs';
export async function assistantFacts({pool,user,commerce,videoQuotaFor,env=process.env}){
 let credits=null;
 try{if(commerce.applies(user)){const balance=await creditBalance(pool,user.id,commerce.mode);credits=Object.fromEntries(Object.entries(balance).map(([key,value])=>[key,{remaining:value.remaining,allocated:value.allocated}]));}
 else{const {rows}=await pool.query("SELECT (SELECT COUNT(*)::int FROM vira_video_usage WHERE user_id=$1 AND period_start=DATE_TRUNC('month',NOW())::date) AS videos,(SELECT COALESCE(SUM(quantity),0)::int FROM vira_image_usage WHERE user_id=$1 AND period_start=DATE_TRUNC('month',NOW())::date) AS images",[user.id]);const limit=videoQuotaFor(user).limit;credits={videos:{remaining:Math.max(0,limit-Number(rows[0].videos)),limit},images:{remaining:Math.max(0,16-Number(rows[0].images)),limit:16}};}}catch{}
 const imageAllowed=env.AI_IMAGES_ALLOW_CLIENTS==='true'||[env.ADMIN_EMAIL,...(env.AI_IMAGE_TEST_EMAILS||'').split(',')].some(email=>email?.trim().toLowerCase()===String(user.email||'').toLowerCase());
 return {credits,features:{aiImages:env.AI_IMAGES_ENABLED==='true'&&Boolean(env.OPENAI_API_KEY)&&imageAllowed,animations:commerce.applies(user)&&commerce.animationEnabled,automaticVoice:Boolean(env.OPENAI_API_KEY),automaticCaptions:Boolean(env.OPENAI_API_KEY)},catalog:offers.map(({id,name,kind,amount,videos,images,animations})=>({id,name,kind,price:amount/100,currency:'CAD',billing:kind==='subscription'?'per month':'one time',videos,images,animations})),purchaseAvailability:'Check the authenticated plans page; catalog amounts are not proof that an offer can be purchased.',navigation:Object.keys(assistantLinks)};
}
