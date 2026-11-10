import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {videoFont} from './video-font.mjs';
export async function sceneTextImage({item,width,height,directory,index,providedSharp}){
 if(!item.text)return null;
 const sharp=providedSharp||(await import('sharp')).default;
 const escape=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const fontfile=await videoFont();
 const buffer=await sharp({text:{text:'<span foreground="'+item.color+'">'+escape(item.text)+'</span>',font:'Abel '+item.size,fontfile,width:Math.floor(width*.88),dpi:72,align:'centre',rgba:true,wrap:'word-char'}}).resize({width:Math.floor(width*.88),height:Math.floor(height*.3),fit:'inside',withoutEnlargement:true}).png().toBuffer();
 const meta=await sharp(buffer).metadata();
 const top=item.position==='top'?Math.round(height*.12):item.position==='bottom'?Math.round(height*.8-meta.height):Math.round((height-meta.height)/2);
 const filename=path.join(directory,'scene-text-'+index+'.png');
 await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:buffer,left:Math.round((width-meta.width)/2),top}]).png().toFile(filename);
 return filename;
}
