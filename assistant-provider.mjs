import './script-model.js';
import {assistantGuide,assistantLinks} from './assistant-knowledge.mjs';
const model=globalThis.olyvexScriptModel;
const fields=['title','objective','target','hook','publication','hashtags','narration','cta','visualPrompt','style'];
const scriptSchema={type:'object',additionalProperties:false,properties:Object.fromEntries([...fields.map(k=>[k,{type:'string'}]),['scenes',{type:'array',items:{type:'string'},minItems:4,maxItems:4}]]),required:[...fields,'scenes']};
export const assistantSchema={type:'object',additionalProperties:false,properties:{reply:{type:'string'},links:{type:'array',items:{type:'string',enum:Object.keys(assistantLinks)},maxItems:3},draft:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{brief:{type:'string'},platform:{type:'string',enum:['Instagram','Facebook','TikTok','YouTube','LinkedIn']},tone:{type:'string',enum:['Professionnel','Dynamique','Amical','Premium','Inspirant']},script:scriptSchema},required:['brief','platform','tone','script']}]}},required:['reply','links','draft']};
export function normalizeAssistantInput(body){
 if(typeof body?.message!=='string'||!body.message.trim()||body.message.length>1600)throw Error('Écrivez un message de 1 à 1 600 caractères.');
 const history=body.history??[];if(!Array.isArray(history)||history.length>8)throw Error('Historique trop long. Commencez une nouvelle discussion.');
 const messages=history.map(item=>{if(!['user','assistant'].includes(item?.role)||typeof item.content!=='string'||item.content.length>2500)throw Error('Historique invalide.');return {role:item.role,content:item.content.trim()};});
 const campaignId=body.campaignId==null?null:Number(body.campaignId);if(campaignId!==null&&(!Number.isSafeInteger(campaignId)||campaignId<=0))throw Error('Campagne invalide.');
 if(body.useBrand!=null&&typeof body.useBrand!=='boolean')throw Error('Choix de marque invalide.');
 return {message:body.message.trim(),history:messages,language:body.language==='en'?'en':'fr',campaignId,useBrand:body.useBrand===true};
}
export function normalizeAssistantDraft(draft){
 if(!draft||typeof draft.brief!=='string'||!draft.brief.trim()||draft.brief.length>2400||!['Instagram','Facebook','TikTok','YouTube','LinkedIn'].includes(draft.platform)||!['Professionnel','Dynamique','Amical','Premium','Inspirant'].includes(draft.tone))throw Error('Proposition de campagne invalide.');
 const script=model.normalize(draft.script);if(!script.objective||!script.target||!script.narration||!script.cta)throw Error('Proposition de campagne incomplète.');
 return {brief:draft.brief.trim(),platform:draft.platform,tone:draft.tone,script};
}
export async function requestAssistant(input,facts,{key=process.env.OPENAI_API_KEY,modelName=process.env.ASSISTANT_MODEL||'gpt-5.4-mini-2026-03-17',fetchImpl=fetch}={}){
 if(!key)throw Error('L’assistante IA est temporairement indisponible.');
 let response;
 try{response=await fetchImpl('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),body:JSON.stringify({model:modelName,store:false,max_output_tokens:3000,reasoning:{effort:'none'},instructions:assistantGuide,input:JSON.stringify({language:input.language,serverFacts:facts,history:input.history,message:input.message}),text:{format:{type:'json_schema',name:'olyvex_assistant',strict:true,schema:assistantSchema}}})});}catch{throw Error('L’assistante n’a pas répondu à temps. Aucun nouvel essai automatique n’a été lancé.');}
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('L’assistante IA est temporairement indisponible. Réessayez plus tard.');}
 let size=0;const chunks=[];for await(const part of response.body){size+=part.length;if(size>128*1024)throw Error('Réponse trop volumineuse. Posez une question plus courte.');chunks.push(part);}
 let result;try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.status!=='completed')throw Error();const text=(data.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('');result=JSON.parse(text);}catch{throw Error('La réponse est incomplète. Reformulez votre demande ou contactez le support.');}
 if(typeof result.reply!=='string'||!result.reply.trim()||result.reply.length>2500||!Array.isArray(result.links)||result.links.length>3||result.links.some(id=>!Object.hasOwn(assistantLinks,id)))throw Error('La réponse reçue est invalide. Réessayez plus tard.');
 return {reply:result.reply.trim(),links:[...new Set(result.links)],draft:result.draft?normalizeAssistantDraft(result.draft):null};
}
