const profiles = {
  female:['coral','French with a natural Quebec accent'], male:['cedar','French with a natural Quebec accent'],
  female_fr:['marin','French with a France accent'], male_fr:['onyx','French with a France accent'],
  female_en_ca:['coral','Canadian English'], male_en_ca:['cedar','Canadian English'],
  female_en_us_ava:['marin','American English'], male_en_us_andrew:['onyx','American English'],
  female_en_gb_sonia:['coral','British English'], male_en_gb_ryan:['cedar','British English']
};
export function voiceProfile(id) {
  if (profiles[id]) return profiles[id];
  // Preserve selections saved by the former Edge voice picker.
  if (typeof id !== 'string' || !/^(female|male)(?:_[a-z]+)*$/.test(id)) throw Object.assign(new Error('Invalid voice'),{code:'VOICE_INVALID_INPUT'});
  const family=id.startsWith('female')?'female':'male';
  return profiles[id.includes('_en_us')?family+'_en_us_'+(family==='female'?'ava':'andrew'):id.includes('_en_gb')?family+'_en_gb_'+(family==='female'?'sonia':'ryan'):id.includes('_fr')?family+'_fr':family];
}
const failure=(code,status)=>Object.assign(new Error(code),{code,...(status?{providerStatus:status}:{})});
export async function requestSpeech(text, gender, {key=process.env.OPENAI_API_KEY, model=process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts-2025-12-15', fetchImpl=fetch}={}) {
  if(typeof text!=='string'||!text.trim()||text.length>800)throw failure('VOICE_INVALID_INPUT');
  const [voice,language]=voiceProfile(gender);
  if(!key)throw failure('VOICE_NOT_CONFIGURED');
  let response;
  try {
    response=await fetchImpl('https://api.openai.com/v1/audio/speech',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(60000),
      body:JSON.stringify({model,voice,input:text.trim(),response_format:'wav',instructions:`Read the supplied text exactly, without additions or paraphrasing. Use ${language}, a clear natural delivery and a professional advertising tone.`})
    });
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw failure(response.status===401||response.status===403?'VOICE_PROVIDER_DENIED':response.status===429?'VOICE_PROVIDER_BUSY':'VOICE_UNAVAILABLE',response.status);}
    if(!response.body)throw failure('VOICE_NO_AUDIO');
    const parts=[];let size=0;
    for await(const part of response.body){size+=part.length;if(size>8*1024*1024)throw failure('VOICE_INVALID_AUDIO');parts.push(part);}
    const audio=Buffer.concat(parts);
    if(!audio.length)throw failure('VOICE_NO_AUDIO');
    if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw failure('VOICE_INVALID_AUDIO');
    return audio;
  }catch(error){
    if(error?.name==='TimeoutError'||error?.name==='AbortError')throw failure('VOICE_TIMEOUT');
    if(error?.code?.startsWith('VOICE_'))throw error;
    throw failure('VOICE_UNAVAILABLE');
  }
}
