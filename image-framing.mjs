export function imageFrameFilter(width,height,color,f){
 const ratio=f.fit==='cover'?'max':'min';
 return `scale=w='max(2,trunc(iw*${ratio}(${width}/iw,${height}/ih)*${f.zoom}/2)*2)':h='max(2,trunc(ih*${ratio}(${width}/iw,${height}/ih)*${f.zoom}/2)*2)',crop=w='min(iw,${width})':h='min(ih,${height})':x='(iw-ow)*${f.x}':y='(ih-oh)*${f.y}',pad=${width}:${height}:(ow-iw)*${f.x}:(oh-ih)*${f.y}:color=${color},setsar=1,fps=30,format=yuv420p`;
}

