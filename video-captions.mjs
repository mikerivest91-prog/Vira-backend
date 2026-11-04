import {writeFile,readFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import './export-model.js';
import {videoFont} from './video-font.mjs';
const exec=promisify(execFile);
// Render a small transparent caption track. No user text enters a filter expression.
export async function applyVideoCaptions({outputPath,directory,ffmpegPath,settings,duration,providedSharp}){
  if(!settings?.captionsEnabled)return false;
  const {width,height}=globalThis.olyvexExportModel.formats[settings.format];
  const cues=globalThis.olyvexExportModel.normalize(settings).cues.filter(c=>c.start<duration).map(c=>({...c,end:Math.min(c.end,duration)}));
  const sharp=providedSharp||(await import('sharp')).default;
  const stripHeight=140,margin=width===1280?180:36,fontSize=width===1280?34:30;
  const fontfile=await videoFont();
  const blank=await sharp({create:{width,height:stripHeight,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  await writeFile(path.join(directory,'caption-blank.png'),blank);
  const escape=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const entries=[];let cursor=0;
  const entry=(name,seconds)=>{if(seconds>0.0001)entries.push(`file '${name}'\noption framerate 1000\nduration ${seconds.toFixed(3)}`);};
  for(let i=0;i<cues.length;i++){
    const cue=cues[i];if(cue.start>=duration)break;
    entry('caption-blank.png',cue.start-cursor);
    const text=await sharp({text:{text:`<span foreground="white">${escape(cue.text)}</span>`,font:`Abel ${fontSize}`,fontfile,width:width-2*margin-32,dpi:72,align:'centre',rgba:true,wrap:'word-char',spacing:4}}).resize({height:100,withoutEnlargement:true}).png().toBuffer();
    const meta=await sharp(text).metadata();
    const boxHeight=Math.min(124,meta.height+24);
    const background=Buffer.from(`<svg width="${width}" height="${stripHeight}"><rect x="${margin}" y="${(stripHeight-boxHeight)/2}" width="${width-2*margin}" height="${boxHeight}" rx="14" fill="#101426" fill-opacity="0.88"/></svg>`);
    const name=`caption-${i}.png`;
    await writeFile(path.join(directory,name),await sharp(blank).composite([{input:background},{input:text,left:Math.round((width-meta.width)/2),top:Math.round((stripHeight-meta.height)/2)}]).png().toBuffer());
    entry(name,Math.min(cue.end,duration)-cue.start);cursor=Math.min(cue.end,duration);
  }
  entry('caption-blank.png',Math.max(0,duration-cursor)+0.1);entries.push("file 'caption-blank.png'\noption framerate 1000");
  await writeFile(path.join(directory,'captions.txt'),entries.join('\n'));
  const run=args=>exec(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{cwd:directory,timeout:180000,maxBuffer:1024*1024,windowsHide:true});
  await run(['-f','concat','-safe','0','-i','captions.txt','-fps_mode','vfr','-c:v','qtrle','-pix_fmt','argb','-threads','1','caption-track.mov']);
  const final=path.join(directory,'vira-captioned.mp4');
  await run(['-i',outputPath,'-i','caption-track.mov','-filter_complex_threads','1','-filter_complex',`[0:v][1:v]overlay=x=0:y=${height-stripHeight-Math.round(height*0.09)}:eof_action=pass:format=auto[v]`,'-map','[v]','-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf','23','-threads','1','-c:a','copy','-pix_fmt','yuv420p','-movflags','+faststart',final]);
  await rename(final,outputPath);return true;
}
