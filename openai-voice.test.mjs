import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestSpeech,voiceProfile} from './openai-voice.mjs';
const wave=()=>{const b=Buffer.alloc(48);b.write('RIFF');b.write('WAVE',8);return b;};
test('requests a WAV narration with a private server key and the selected accent',async()=>{
 let request;
 const audio=await requestSpeech(' Bonjour. ','female',{key:'test-only',fetchImpl:async(url,options)=>{request={url,options};return new Response(wave());}});
 assert.equal(audio.toString('ascii',0,4),'RIFF');
 assert.equal(request.url,'https://api.openai.com/v1/audio/speech');
 const body=JSON.parse(request.options.body);
 assert.equal(body.input,'Bonjour.');assert.equal(body.response_format,'wav');assert.equal(body.voice,'coral');assert.match(body.instructions,/Quebec/);
 assert.equal(request.options.headers.Authorization,'Bearer test-only');assert.ok(request.options.signal);
});
test('validates input and credentials before contacting the provider',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;};
 await assert.rejects(requestSpeech('a'.repeat(801),'female',{key:'test',fetchImpl}),{code:'VOICE_INVALID_INPUT'});
 await assert.rejects(requestSpeech('Bonjour','female',{key:'',fetchImpl}),{code:'VOICE_NOT_CONFIGURED'});
 assert.equal(calls,0);
});
test('does not retry billed requests and returns only safe error codes',async()=>{
 for(const [status,code] of [[401,'VOICE_PROVIDER_DENIED'],[403,'VOICE_PROVIDER_DENIED'],[429,'VOICE_PROVIDER_BUSY'],[500,'VOICE_UNAVAILABLE']]){
  let calls=0;
  await assert.rejects(requestSpeech('Bonjour','female',{key:'private-sentinel',fetchImpl:async()=>{calls++;return new Response('private provider detail',{status});}}),error=>error.code===code&&error.providerStatus===status&&!error.message.includes('private'));
  assert.equal(calls,1);
 }
});
test('rejects empty, corrupt and oversized responses',async()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from('not audio'),Buffer.alloc(8*1024*1024+1)]){
  await assert.rejects(requestSpeech('Bonjour','female',{key:'test',fetchImpl:async()=>new Response(bytes)}),error=>['VOICE_NO_AUDIO','VOICE_INVALID_AUDIO'].includes(error.code));
 }
});
test('maps request timeouts without leaking provider details',async()=>{
 await assert.rejects(requestSpeech('Bonjour','female',{key:'test',fetchImpl:async()=>{throw new DOMException('private','TimeoutError');}}),{code:'VOICE_TIMEOUT'});
});
test('preserves legacy saved voice selections',()=>{
 assert.deepEqual(voiceProfile('female_fr_brigitte'),['marin','French with a France accent']);
 assert.deepEqual(voiceProfile('male_en_us_guy'),['onyx','American English']);
 assert.throws(()=>voiceProfile('not-a-voice'),{code:'VOICE_INVALID_INPUT'});
});
