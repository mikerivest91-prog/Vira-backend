import fs from 'node:fs/promises';
import path from 'node:path';
import {audioFile,wavDuration} from './audio-service.mjs';
import {readClip} from './clip-service.mjs';
import './script-model.js';
export async function inspectProductionMedia(data,userId,{audioDirectory,clipDirectory,videoDirectory,decodeImage,io=fs,durationOf=wavDuration,clipReader=readClip}){
 let visuals=false,voice=false,video=false;
 if(Array.isArray(data.sourceClips)&&data.sourceClips.length===4){try{await Promise.all(data.sourceClips.map(c=>clipReader(clipDirectory,userId,c.id)));visuals=true;}catch{}}
 else if(Array.isArray(data.generatedImages)&&data.generatedImages.length===4){try{data.generatedImages.forEach((image,i)=>decodeImage(image,i));visuals=true;}catch{}}
 if(data.narration?.audioId){try{await durationOf(audioFile(audioDirectory,userId,data.narration.audioId));voice=true;}catch{}}
 if(typeof data.videoUrl==='string'&&/^\/videos\/vira-[a-zA-Z0-9_-]+\.mp4$/.test(data.videoUrl)){try{const file=path.join(videoDirectory,data.videoUrl.slice('/videos/'.length));const owner=JSON.parse(await io.readFile(file+'.owner.json','utf8'));const stat=await io.stat(file);video=String(owner.userId)===String(userId)&&stat.isFile()&&stat.size>0;}catch{}}
 return {visuals,voice,video};
}
