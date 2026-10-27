import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
const runFile = promisify(execFile);
const workerPath = fileURLToPath(new URL('./voice-worker.cjs', import.meta.url));
const voiceMessages = {
  VOICE_TIMEOUT: 'Le service vocal n’a pas répondu à temps. Réessayez plus tard ou importez votre narration.',
  VOICE_PROVIDER_DENIED: 'Le fournisseur vocal refuse la connexion. Importez votre narration en attendant le rétablissement du service.',
  VOICE_PROVIDER_BUSY: 'Le fournisseur vocal est temporairement saturé. Réessayez plus tard ou importez votre narration.',
  VOICE_NO_AUDIO: 'Le fournisseur vocal n’a renvoyé aucun audio. Réessayez plus tard ou importez votre narration.',
  VOICE_INVALID_AUDIO: 'Le fournisseur vocal a renvoyé un audio invalide. Importez votre narration.',
  VOICE_UNAVAILABLE: 'La voix automatique est indisponible. Réessayez plus tard ou importez votre narration.'
};
export function voiceFailure(code, diagnostics = {}) {
  const safeCode = Object.hasOwn(voiceMessages, code) ? code : 'VOICE_UNAVAILABLE';
  return Object.assign(new Error(voiceMessages[safeCode]), {code:safeCode, ...diagnostics});
}
export function audioFile(directory, userId, id) {
  if (!/^\d+$/.test(String(userId)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id))) throw Error('Audio invalide.');
  return path.join(directory, `audio-${userId}-${id}.wav`);
}
export async function wavDuration(filename) {
  const b = await fs.readFile(filename);
  if (b.toString('ascii',0,4)!=='RIFF' || b.toString('ascii',8,12)!=='WAVE') throw Error('Audio WAV invalide.');
  let rate=0, size=0;
  for(let offset=12;offset+8<=b.length;){const tag=b.toString('ascii',offset,offset+4);const n=b.readUInt32LE(offset+4);if(offset+8+n>b.length)throw Error('Audio incomplet.');if(tag==='fmt '&&n>=16)rate=b.readUInt32LE(offset+16);if(tag==='data')size=n;offset+=8+n+(n%2);}
  const seconds=size/rate;
  if(!Number.isFinite(seconds)||seconds<=0||seconds>60)throw Error('La narration doit durer entre 1 et 60 secondes. Raccourcissez le texte ou le fichier.');
  return seconds;
}
export async function prepareAudio(input, directory, userId) {
  const id=crypto.randomUUID();const output=audioFile(directory,userId,id);
  try {
    await runFile(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input,'-vn','-t','61','-ac','1','-ar','22050','-c:a','pcm_s16le',output],{timeout:45000,windowsHide:true,maxBuffer:1024*1024});
    const duration=await wavDuration(output);
    return { audioId:id, duration, audioUrl:`/api/audio/${id}` };
  } catch(error){await fs.unlink(output).catch(()=>{});throw error;}
}
export async function synthesizeAudio(text, gender, directory, userId) {
  const input=path.join(directory,`synthesis-${crypto.randomUUID()}.wav`);
  try {
    await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[workerPath,input],{windowsHide:true,stdio:['pipe','ignore','pipe']});
      let pending='', failureCode='VOICE_UNAVAILABLE';
      const diagnostics={stage:'starting'};
      const timer=setTimeout(()=>{child.kill('SIGKILL');reject(voiceFailure('VOICE_TIMEOUT',diagnostics));},30000);
      child.stderr.on('data',buffer=>{
        pending=(pending+buffer.toString()).slice(-8192);
        let newline;
        while((newline=pending.indexOf('\n'))!==-1){
          const line=pending.slice(0,newline);pending=pending.slice(newline+1);
          try {
            const event=JSON.parse(line);
            if(['connecting','receiving','audio_received','complete'].includes(event.stage))diagnostics.stage=event.stage;
            if(Object.hasOwn(voiceMessages,event.code))failureCode=event.code;
            if(Number.isInteger(event.providerStatus)&&event.providerStatus>=100&&event.providerStatus<=599)diagnostics.providerStatus=event.providerStatus;
          } catch {}
        }
      });
      child.on('error',()=>{clearTimeout(timer);reject(voiceFailure('VOICE_UNAVAILABLE',diagnostics));});
      child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(voiceFailure(failureCode,diagnostics));});
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({text,gender}));
    });
    return await prepareAudio(input,directory,userId);
  } finally {await fs.unlink(input).catch(()=>{});}
}
