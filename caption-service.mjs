import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import './export-model.js';
const model=globalThis.olyvexExportModel;
export function wordCues(words,duration){
  if(!Array.isArray(words)||!words.length||words.length>1200)throw Error('La transcription ne contient aucun repère vocal exploitable.');
  const cues=[];let current=null,last=0;
  for(const item of words){const text=typeof item?.word==='string'?item.word.trim():'';const start=Number(item?.start),end=Math.min(Number(item?.end),duration);
    if(!text||!Number.isFinite(start)||!Number.isFinite(end)||start<last-0.05||start<0||end<=start||end>60.05||text.length>60)throw Error('Les repères vocaux reçus sont invalides.');
    const s=Math.max(last,start);if(end<=s)continue;
    if(current&&(current.text.length+text.length>56||end-current.start>3.5||s-current.end>0.65)){cues.push(current);current=null;}
    if(!current)current={start:s,end,text};else{current.text+=' '+text;current.end=end;}
    last=end;
  }
  if(current)cues.push(current);
  return model.normalize({audioId:'00000000-0000-0000-0000-000000000000',cues},duration).cues;
}
export async function transcribeCaptions(audio,duration,{key=process.env.OPENAI_API_KEY,fetchImpl=fetch}={}){
  if(!key)throw Error('La synchronisation automatique est indisponible. Vous pouvez saisir les sous-titres manuellement.');
  const form=new FormData();form.set('file',new Blob([audio],{type:'audio/wav'}),'narration.wav');form.set('model','whisper-1');form.set('response_format','verbose_json');form.append('timestamp_granularities[]','word');form.set('temperature','0');
  let response;
  try{response=await fetchImpl('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(60000)});}catch{throw Error('La synchronisation n’a pas répondu. Aucun nouvel essai automatique ne sera lancé.');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('La synchronisation automatique est indisponible. Réessayez plus tard ou saisissez les temps manuellement.');}
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('Réponse de synchronisation trop volumineuse.');chunks.push(chunk);}
  let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Réponse de synchronisation invalide.');}
  return wordCues(result.words,duration);
}
export async function cachedCaptions(filename,duration,{reserve,transcribe=transcribeCaptions,accept=async()=>{}}){
  const audio=await fs.readFile(filename),hash=crypto.createHash('sha256').update(audio).digest('hex');
  const cache=filename+'.captions.json';
  try{const saved=JSON.parse(await fs.readFile(cache,'utf8'));if(saved.hash===hash)return {cues:model.normalize({...saved,audioId:'00000000-0000-0000-0000-000000000000'},duration).cues,cached:true};}catch(error){if(error.code!=='ENOENT'&&error.code)throw error;}
  if(!await reserve())throw Object.assign(Error('La limite quotidienne de préparations vocales est atteinte. Réessayez demain.'),{status:429});
  const cues=await transcribe(audio,duration);const pending=cache+'.partial';
  try{await fs.writeFile(pending,JSON.stringify({hash,cues}),{mode:0o600});await accept([pending]);await fs.rename(pending,cache);}finally{await fs.unlink(pending).catch(()=>{});}
  return {cues,cached:false};
}
