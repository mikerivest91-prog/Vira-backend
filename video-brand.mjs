import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,rename,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
let capability;
export async function canRenderBrand(ffmpegPath){
  if(capability)return capability;
  capability=(async()=>{try{await access(process.platform==='win32'?'C:/Windows/Fonts/arial.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');const r=await exec(ffmpegPath,['-hide_banner','-filters'],{timeout:10000,maxBuffer:1024*1024,windowsHide:true});return /\bdrawtext\b/.test(r.stdout);}catch{return false;}})();return capability;
}
export function wrapBrandText(value,width=34,maxLines=3){
  const words=String(value||'').replace(/[\u0000-\u001f]/g,' ').split(/\s+/).filter(Boolean);const lines=[];let line='';
  for(const word of words){for(let i=0;i<word.length;i+=width){const part=word.slice(i,i+width);if(line.length+part.length+1>width){lines.push(line);line='';}line+=(line?' ':'')+part;}}
  if(line)lines.push(line);return lines.slice(0,maxLines).join('\n');
}
export function mediaDuration(stderr){const match=String(stderr).match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);return match?Number(match[1])*3600+Number(match[2])*60+Number(match[3]):null;}
export async function applyVideoBrand({outputPath,directory,ffmpegPath,brand}){
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
    await copyFile(process.platform==='win32'?'C:/Windows/Fonts/arial.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',path.join(directory,'brand-font.ttf'));
    const color=field=>/^#[0-9a-f]{6}$/i.test(brand[field]||'')?brand[field].slice(1):'263249';
    await writeFile(path.join(directory,'brand-name.txt'),wrapBrandText(brand.name,24,3));
    await writeFile(path.join(directory,'brand-contact.txt'),[brand.tagline,brand.website,brand.email,brand.phone,brand.address].filter(Boolean).map(v=>wrapBrandText(v,36,2)).slice(0,4).join('\n\n'));
    const enabled=`gte(t,${Math.max(0,duration-3).toFixed(3)})`;
    filters.push(`[${current}]drawbox=x=0:y=0:w=iw:h=ih:color=0x${color('primaryColor')}:t=fill:enable='${enabled}',drawbox=x=40:y=270:w=640:h=800:color=white@0.97:t=fill:enable='${enabled}',drawtext=fontfile=brand-font.ttf:textfile=brand-name.txt:expansion=none:fontcolor=0x${color('secondaryColor')}:fontsize=42:line_spacing=10:x=(w-tw)/2:y=340:enable='${enabled}',drawtext=fontfile=brand-font.ttf:textfile=brand-contact.txt:expansion=none:fontcolor=0x${color('secondaryColor')}:fontsize=25:line_spacing=8:x=(w-tw)/2:y=550:enable='${enabled}'[branded]`);current='branded';
  }
  const final=path.join(directory,'vira-branded.mp4');
  await run([...inputs,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[${current}]`,'-map','0:a?','-c:v','libx264','-preset','ultrafast','-crf','23','-threads','1','-c:a','copy','-pix_fmt','yuv420p','-movflags','+faststart',final]);
  await rename(final,outputPath);return true;
}

