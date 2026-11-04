(function(root){
  const formats=Object.freeze({portrait:{width:720,height:1280,label:'Portrait · 9:16'},square:{width:720,height:720,label:'Carré · 1:1'},landscape:{width:1280,height:720,label:'Paysage · 16:9'}});
  function normalize(value={},duration=60){
    if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Options d’export invalides.');
    const format=value.format??'portrait';if(!Object.hasOwn(formats,format))throw Error('Choisissez un format vidéo valide.');
    const enabled=value.captionsEnabled===true;
    const source=value.cues??[];
    if(!Array.isArray(source)||source.length>100)throw Error('Maximum 100 sous-titres.');
    let last=0,total=0;
    const cues=source.map(c=>{const start=c?.start,end=c?.end,text=typeof c?.text==='string'?c.text.trim():'';
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||start<last||end<=start||end>duration+0.05||!text||text.length>100||/[\u0000-\u0008\u000b-\u001f]/.test(text))throw Error('Vérifiez les textes et les temps des sous-titres : ordre croissant, sans chevauchement, dans la durée de la voix.');
      last=end;total+=text.length;if(total>6000)throw Error('Sous-titres trop longs.');
      return {start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,text};});
    const audioId=typeof value.audioId==='string'?value.audioId:'';
    if((enabled||cues.length)&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(audioId))throw Error('Préparez la voix correspondant aux sous-titres.');
    if(enabled&&!cues.length)throw Error('Créez ou ajoutez des sous-titres avant de les intégrer.');
    return {format,captionsEnabled:enabled,audioId,cues};
  }
  function timestamp(seconds,separator){const n=Math.round(seconds*1000);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')}${separator}${String(n%1000).padStart(3,'0')}`;}
  function subtitles(cues,vtt=false){return (vtt?'WEBVTT\n\n':'')+cues.map((c,i)=>`${i+1}\n${timestamp(c.start,vtt?'.':',')} --> ${timestamp(c.end,vtt?'.':',')}\n${c.text.replace(/[<>]/g,'')}\n`).join('\n');}
  root.olyvexExportModel=Object.freeze({formats,normalize,subtitles});
})(globalThis);
