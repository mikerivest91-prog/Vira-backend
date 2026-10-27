import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { requestSpeech } from './openai-voice.mjs';
import ffmpegPath from 'ffmpeg-static';
const runFile = promisify(execFile);

const voiceMessages = {
  VOICE_NOT_CONFIGURED: 'La voix automatique n’est pas configurée sur le serveur. Importez votre narration.',
  VOICE_INVALID_INPUT: 'Ajoutez une narration de 800 caractères maximum et choisissez une voix.',
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
    try {
      const audio=await requestSpeech(text,gender);
      await fs.writeFile(input,audio,{flag:'wx'});
    } catch(error) { throw voiceFailure(error.code,{stage:'synthesis',providerStatus:error.providerStatus}); }
    return await prepareAudio(input,directory,userId);
  } finally {await fs.unlink(input).catch(()=>{});}
}
