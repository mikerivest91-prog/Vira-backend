// Original synthesized sounds: no downloaded recordings or third-party licenses.
export const sounds = [
  {id:'soft',kind:'music',name:'Douce · piano synthétique'},
  {id:'modern',kind:'music',name:'Moderne · publicité'},
  {id:'energy',kind:'music',name:'Énergique · pulsation'},
  {id:'whoosh',kind:'effect',name:'Souffle de transition'},
  {id:'chime',kind:'effect',name:'Carillon léger'},
  {id:'pop',kind:'effect',name:'Pop discret'}
];
export function soundOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Sélection sonore invalide.');
  const result={music:input.music||'',effect:input.effect||'',musicVolume:input.musicVolume??0.12,effectVolume:input.effectVolume??0.2};
  for(const [key,kind] of [['music','music'],['effect','effect']]) if(result[key]&&!sounds.some(s=>s.id===result[key]&&s.kind===kind))throw Error('Son inconnu.');
  for(const key of ['musicVolume','effectVolume'])if(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<0||result[key]>0.5)throw Error('Volume invalide.');
  return result;
}
export function soundWav(id,duration=8,transitions=false) {
  const item=sounds.find(s=>s.id===id);if(!item)throw Error('Son inconnu.');
  if(!Number.isFinite(duration)||duration<=0||duration>61)throw Error('Durée sonore invalide.');
  const rate=22050,count=Math.ceil(duration*rate),b=Buffer.alloc(44+count*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);
  const sin=(f,t)=>Math.sin(2*Math.PI*f*t);let seed=81;
  for(let i=0;i<count;i++){
    const t=i/rate;let x=0;
    if(item.kind==='music'){
      const beat=id==='soft'?0.6:id==='modern'?0.5:0.4;
      const chord=[261.626,220,174.614,195.998][Math.floor(t/(beat*4))%4];
      const phase=t%beat,step=Math.floor(t/beat)%4;
      const note=chord*[1,1.25,1.5,2][step];
      x=0.26*(sin(note,t)+0.25*sin(note*2,t))*Math.exp(-phase*(id==='soft'?5:9));
      x+=0.07*sin(chord/2,t);
      if(id!=='soft')x+=0.2*sin(65,phase)*Math.exp(-phase*24);
      x*=Math.min(1,t/0.15,(duration-t)/0.35);
    }else{
      const positions=transitions?[duration/4,duration/2,3*duration/4]:[0.1];
      for(const start of positions){const p=t-start;if(p<0||p>0.65)continue;
        if(id==='chime')x+=0.3*(sin(880,p)+0.4*sin(1320,p))*Math.exp(-p*9)*Math.min(1,p/0.01);
        if(id==='pop')x+=0.5*sin(220-100*p,p)*Math.exp(-p*35)*Math.min(1,p/0.004);
        if(id==='whoosh'){seed=(seed*1664525+1013904223)>>>0;x+=(seed/4294967296*2-1)*0.32*Math.sin(Math.PI*p/0.65)**2;}
      }
    }
    b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),44+i*2);
  }
  return b;
}
