import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
const runFile = promisify(execFile);
const workerPath = fileURLToPath(new URL('./voice-worker.cjs', import.meta.url));
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
      let detail='';const timer=setTimeout(()=>{child.kill();reject(Error('La génération vocale a dépassé le délai.'));},30000);
      child.stderr.on('data',b=>{detail=(detail+b.toString()).slice(-1000);});
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Synthèse vocale indisponible. '+detail));});
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({text,gender}));
    });
    return await prepareAudio(input,directory,userId);
  } finally {await fs.unlink(input).catch(()=>{});}
}
