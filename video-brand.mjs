import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,rename,copyFile,access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {videoFont} from './video-font.mjs';
const exec=promisify(execFile);
let capability;
export async function canRenderBrand(ffmpegPath){
  if(capability)return capability;
  capability=(async()=>{try{await access(new URL('./brand-font.base64',import.meta.url));const r=await exec(ffmpegPath,['-hide_banner','-filters'],{timeout:10000,maxBuffer:1024*1024,windowsHide:true});const {default:sharp}=await import("sharp");return /\boverlay\b/.test(r.stdout)&&Boolean(sharp.versions?.vips);}catch{return false;}})();return capability;
}
export function wrapBrandText(value,width=34,maxLines=3){
  const words=String(value||'').replace(/[\u0000-\u001f]/g,' ').split(/\s+/).filter(Boolean);const lines=[];let line='';
  for(const word of words){for(let i=0;i<word.length;i+=width){const part=word.slice(i,i+width);if(line.length+part.length+1>width){lines.push(line);line='';}line+=(line?' ':'')+part;}}
  if(line)lines.push(line);return lines.slice(0,maxLines).join('\n');
}
export function mediaDuration(stderr){const match=String(stderr).match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);return match?Number(match[1])*3600+Number(match[2])*60+Number(match[3]):null;}
export async function applyVideoBrand({outputPath,directory,ffmpegPath,brand,providedSharp,width=720,height=1280}){
  if(!brand?.videoBrandingEnabled)return false;
  const logo=typeof brand.logo==='string'&&brand.logo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  const endCard=brand.videoEndCardEnabled!==false&&Boolean(brand.name);
  if(!logo&&!endCard)return false;
  const run=args=>exec(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{cwd:directory,timeout:180000,maxBuffer:1024*1024,windowsHide:true});
  let duration=null;
  if(endCard){try{await exec(ffmpegPath,['-hide_banner','-i',outputPath],{timeout:10000,maxBuffer:1024*1024,windowsHide:true});}catch(error){duration=mediaDuration(error.stderr);}
    if(!duration)throw Error('Durée vidéo indisponible pour la marque.');}
  const inputs=['-i',outputPath],filters=[];let current='0:v';
  if(logo){const filename='brand-logo.'+(logo[1]==='jpeg'?'jpg':logo[1]);await writeFile(path.join(directory,filename),Buffer.from(logo[2],'base64'));inputs.push('-i',path.join(directory,filename));filters.push('[1:v]scale=140:140:force_original_aspect_ratio=decrease[logo]','[0:v][logo]overlay=x=W-w-28:y=28:eof_action=repeat[marked]');current='marked';}
  if(endCard){
    const fontfile=await videoFont();
    const card=path.join(directory,'brand-card.png');
    await writeFile(card,await renderBrandCard(brand,fontfile,providedSharp,{width,height}));
    const index=inputs.filter(value=>value==='-i').length;
    inputs.push('-i',card);
    const enabled=`gte(t,${Math.max(0,duration-3).toFixed(3)})`;
    filters.push(`[${current}][${index}:v]overlay=0:0:eof_action=repeat:enable='${enabled}'[branded]`);current='branded';
  }
  const final=path.join(directory,'vira-branded.mp4');
  await run([...inputs,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[${current}]`,'-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf','23','-threads','1','-c:a','copy','-pix_fmt','yuv420p','-movflags','+faststart',final]);
  await rename(final,outputPath);return true;
}


export async function renderBrandCard(brand,fontfile,providedSharp,{width=720,height=1280}={}){
 const sharp=providedSharp||(await import('sharp')).default;
 const color=field=>/^#[0-9a-f]{6}$/i.test(brand[field]||'')?brand[field]:'#263249';
 const escape=value=>String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
 const cardWidth=Math.min(width-80,1000),cardHeight=Math.round(height*.68),cardTop=Math.round(height*.12),textWidth=cardWidth-64;
 const overlays=[{input:Buffer.from(`<svg width="${width}" height="${height}"><rect x="${(width-cardWidth)/2}" y="${cardTop}" width="${cardWidth}" height="${cardHeight}" rx="24" fill="white"/></svg>`),top:0,left:0}];
 for(const [text,top,boxHeight,size] of [[wrapBrandText(brand.name,width>720?42:24,2),cardTop+40,Math.round(cardHeight*.23),46],[[brand.tagline,brand.website,brand.email,brand.phone,brand.address].filter(Boolean).map(v=>wrapBrandText(v,width>720?60:36,2)).slice(0,4).join('\n\n'),cardTop+Math.round(cardHeight*.34),Math.round(cardHeight*.56),28]]){
  if(!text)continue;
  const buffer=await sharp({text:{text:'<span foreground="'+color('secondaryColor')+'">'+escape(text)+'</span>',font:'Abel '+size,fontfile,width:textWidth,dpi:72,align:'centre',rgba:true,wrap:'word-char'}}).resize({width:textWidth,height:boxHeight,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const metadata=await sharp(buffer).metadata();overlays.push({input:buffer,left:Math.round((width-metadata.width)/2),top});
 }
 return sharp({create:{width,height,channels:4,background:color('primaryColor')}}).composite(overlays).png().toBuffer();
}
