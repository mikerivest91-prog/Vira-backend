// Original synthesized compositions and effects, generated locally.
const families = [
 ['calm','Douces',72,['Matin calme','Lumière douce','Pause détente','Cocon']],
 ['popmusic','Publicité',112,['Vitrine','Nouvelle collection','Bonne humeur','Grand lancement']],
 ['electro','Électro',126,['Néon','Impulsion','Ville de nuit','Mouvement']],
 ['lofi','Lo-fi',82,['Café tranquille','Fin de journée','Petit atelier','Balade']],
 ['cinema','Cinématiques',90,['Horizon','Découverte','Élan','Moment fort']],
 ['ambient','Ambiances',65,['Nuages','Respiration','Espace','Aurore']],
 ['retro','Rétro',118,['Arcade','Pixel','Flashback','Synthwave']],
 ['beat','Rythmiques',98,['Street','Groove','Focus','Cadence']]
];
const effectFamilies=[
 ['sweep','Transitions',['Souffle doux','Balayage rapide','Montée','Descente']],
 ['bell','Carillons',['Clochette','Cristal','Note lumineuse','Accord de fin']],
 ['hit','Impacts',['Impact grave','Petit coup','Accent sec','Percussion douce']],
 ['notify','Notifications',['Confirmation','Double bip','Message','Succès']],
 ['digital','Numériques',['Laser','Décollage','Robot','Arcade']],
 ['click','Clics et accents',['Clic léger','Déclic','Pop rond','Rebond']],
 ['tools','Construction · simulations',['Marteau','Perceuse','Scie électrique','Clé à chocs']],
 ['car','Auto · simulations',['Moteur au ralenti','Accélération','Klaxon','Clignotant']],
 ['home','Maison · simulations',['Sonnette','Horloge','Téléphone','Aspirateur']],
 ['nature','Nature · simulations',['Pluie','Vent','Vagues','Oiseau']]
];
export const sounds=[
 {id:'soft',kind:'music',name:'Douce · piano synthétique',category:'Classiques',family:'calm',variant:0,bpm:100},
 {id:'modern',kind:'music',name:'Moderne · publicité',category:'Classiques',family:'popmusic',variant:1,bpm:120},
 {id:'energy',kind:'music',name:'Énergique · pulsation',category:'Classiques',family:'electro',variant:2,bpm:150},
 ...families.flatMap(([family,category,bpm,names])=>names.map((name,variant)=>({id:family+'-'+variant,kind:'music',name,category,family,variant,bpm:bpm+variant*4}))),
 {id:'whoosh',kind:'effect',name:'Souffle de transition',category:'Classiques',family:'sweep',variant:0},
 {id:'chime',kind:'effect',name:'Carillon léger',category:'Classiques',family:'bell',variant:0},
 {id:'pop',kind:'effect',name:'Pop discret',category:'Classiques',family:'click',variant:0},
 ...effectFamilies.flatMap(([family,category,names])=>names.map((name,variant)=>({id:family+'-'+variant,kind:'effect',name,category,family,variant})))
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
  const sin=(f,t)=>Math.sin(2*Math.PI*f*t);let seed=Array.from(id).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,81);
  for(let i=0;i<count;i++){
    const t=i/rate;let x=0;
    if(item.kind==='music'){
      const v=item.variant,beat=60/item.bpm,phase=t%beat,step=Math.floor(t/beat);
      const roots=[[0,5,9,7],[0,9,5,7],[0,7,5,9],[9,5,0,7]][v];
      const root=220*Math.pow(2,(roots[Math.floor(step/4)%4]+v*2)/12);
      const pattern=[[0,4,7,12,7,4,2,7],[0,7,4,9,12,7,4,2],[12,7,4,0,2,4,7,9],[0,2,7,4,9,7,12,4]][v];
      const note=root*Math.pow(2,pattern[step%8]/12),f=item.family;
      if(f==='ambient'||f==='cinema'){
        x=0.12*(sin(root,t)+0.65*sin(root*1.25,t)+0.45*sin(root*1.5,t))*(0.7+0.3*sin(0.15,t));
        if(f==='cinema')x+=0.14*sin(note,t)*Math.exp(-phase*4);
      }else{
        const tone=f==='retro'?Math.tanh(2*sin(note,t)):f==='electro'?(sin(note,t)+0.4*sin(note*2,t)+0.2*sin(note*3,t)):sin(note,t)+0.18*sin(note*2,t);
        x=0.17*tone*Math.exp(-phase*(f==='calm'?4:f==='lofi'?7:10))*Math.min(1,phase/0.006);
        x+=0.07*sin(root/2,t)*(0.6+0.4*Math.exp(-phase*4));
        if(!['calm'].includes(f)){
          x+=0.16*sin(55+v*5,phase)*Math.exp(-phase*28);
          if(step%2===1)x+=0.035*sin(1800+v*200,t)*Math.exp(-phase*55);
        }
      }
      x*=Math.max(0,Math.min(1,t/0.15,(duration-t)/0.35));
    }else{
      const positions=transitions?[duration/4,duration/2,3*duration/4]:[0.1];
      const v=item.variant,f=item.family;
      for(const start of positions){const p=t-start;if(p<0||p>0.65)continue;
        const attack=Math.min(1,p/0.005),freq=650+v*220+(id==='chime'?80:0);
        seed=(seed*1664525+1013904223)>>>0;
        const noise=seed/4294967296*2-1,fade=Math.max(0,Math.min(1,p/0.01,(0.65-p)/0.08));
        if(f==='tools'){
          if(v===0||v===3){const q=p%(v===0?0.22:0.075);x+=(0.3*noise+0.2*sin(150,q))*Math.exp(-q*70);}
          if(v===1)x+=(0.18*sin(180,p)+0.09*sin(900,p)+0.07*noise)*fade;
          if(v===2)x+=(0.17*Math.tanh(3*sin(250,p))+0.12*noise)*fade;
        }
        if(f==='car'){
          if(v<2){const cycles=(v===0?38*p:30*p+95*p*p);x+=(0.22*Math.sin(2*Math.PI*cycles)+0.1*Math.sin(2*Math.PI*cycles*3)+0.04*noise)*fade;}
          if(v===2)x+=0.22*(sin(350,p)+sin(440,p))*fade;
          if(v===3){const q=p%0.3;x+=0.4*noise*Math.exp(-q*160);}
        }
        if(f==='home'){
          if(v===0)x+=0.3*sin(p<0.3?660:520,p)*Math.exp(-(p%0.3)*8)*attack;
          if(v===1)x+=0.4*noise*Math.exp(-(p%0.5)*120);
          if(v===2)x+=0.18*(sin(440,p)+sin(480,p))*(sin(20,p)>0?1:0.3)*fade;
          if(v===3)x+=(0.18*noise+0.1*sin(140,p))*fade;
        }
        if(f==='nature'){
          if(v===0)x+=noise*0.25*fade;
          if(v===1)x+=noise*0.16*(0.5+0.5*sin(1.2,p))*fade;
          if(v===2)x+=noise*0.22*Math.sin(Math.PI*p/0.65)**2;
          if(v===3)x+=0.2*Math.sin(2*Math.PI*(1800*p+1200*p*p))*Math.exp(-p*6)*attack;
        }
        if(f==='bell')x+=0.3*(sin(freq,p)+0.4*sin(freq*1.5,p))*Math.exp(-p*(5+v*2))*attack;
        if(f==='click')x+=0.45*sin(220+v*160+(id==='pop'?70:0),p)*Math.exp(-p*(45-v*7))*attack;
        if(f==='hit')x+=0.45*(sin(55+v*45,p)+0.2*sin(170+v*70,p))*Math.exp(-p*(9+v*8))*attack;
        if(f==='notify'){
          const q=v===1?p%0.22:p;
          x+=0.3*sin(freq*(p>0.2?1.25:1),q)*Math.exp(-q*18)*Math.min(1,q/0.005);
        }
        if(f==='digital')x+=0.3*Math.tanh(2*sin((v%2?180+v*70:1600+v*250)*p+(v%2?1100+v*200:-900-v*150)*p*p/2,1))*Math.exp(-p*7)*attack;
        if(f==='sweep'){
          seed=(seed*1664525+1013904223)>>>0;
          const envelope=Math.sin(Math.PI*p/0.65)**(v===1?6:2);
          x+=((seed/4294967296*2-1)*0.23+0.1*sin(300+(v%2?-250:900)*p,p))*envelope;
        }
      }
    }
    b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),44+i*2);
  }
  return b;
}

