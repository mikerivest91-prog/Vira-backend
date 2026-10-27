const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {once}=require('node:events');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const WebSocket=require('ws');
const {createVoiceTransport,saveVoice}=require('./voice-transport.cjs');

test('HTTP 403 is observed before the rejected socket terminates',async()=>{
 const server=http.createServer();
 server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const events=[];
 const socket=createVoiceTransport(WebSocket,event=>events.push(event))(`ws://127.0.0.1:${server.address().port}`);
 let observed;
 socket.once('unexpected-response',(_request,response)=>{observed=response.statusCode;});
 socket.on('error',()=>{});
 try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Handshake remained open')),2000);socket.once('close',()=>{clearTimeout(timer);resolve();});});
  assert.equal(observed,403);assert.equal(events.at(-1).providerStatus,403);
 }finally{socket.terminate();await new Promise(resolve=>server.close(resolve));}
});

test('audio is fully written before completion is reported',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'olyvex-voice-'));
 const filename=path.join(dir,'voice.mp3');
 const events=[];
 const source={async *stream(){yield {type:'SentenceBoundary',text:'private text'};yield {type:'audio',data:Buffer.from([1,2,3])};yield {type:'audio',data:Buffer.from([4,5])};}};
 try{await saveVoice(source,filename,event=>events.push(event));assert.deepEqual(await fs.readFile(filename),Buffer.from([1,2,3,4,5]));assert.deepEqual(events,[{stage:'audio_received'},{stage:'complete'}]);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('empty and interrupted streams never leave usable partial audio',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'olyvex-voice-'));
 const filename=path.join(dir,'voice.mp3');
 try{
  await assert.rejects(saveVoice({async *stream(){}},filename),{code:'VOICE_NO_AUDIO'});
  await assert.rejects(fs.access(filename));
  await assert.rejects(saveVoice({async *stream(){yield {type:'audio',data:Buffer.from([1])};throw Error('provider failed');}},filename),/provider failed/);
  await assert.rejects(fs.access(filename));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('provider failures have safe actionable messages',async()=>{
 const {voiceFailure}=await import('./audio-service.mjs');
 const error=voiceFailure('VOICE_PROVIDER_DENIED',{stage:'connecting',providerStatus:403});
 assert.match(error.message,/refuse la connexion/);assert.equal(error.providerStatus,403);
 assert.match(voiceFailure('VOICE_TIMEOUT').message,/pas répondu à temps/);
 assert.equal(voiceFailure('untrusted-provider-text').code,'VOICE_UNAVAILABLE');
});
