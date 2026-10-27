const fs = require('node:fs/promises');

// edge-tts.js observes unexpected-response but does not close its socket.
// Let its listener record the HTTP status before terminating the rejected handshake.
function createVoiceTransport(WebSocket, report = () => {}) {
  return (url, protocols, options) => {
    report({stage:'connecting'});
    const socket = new WebSocket(url, protocols, {...options, handshakeTimeout:10000});
    socket.once('open', () => report({stage:'receiving'}));
    socket.once('unexpected-response', (_request, response) => {
      report({stage:'connecting', providerStatus:response.statusCode});
      queueMicrotask(() => { response.resume(); socket.terminate(); });
    });
    return socket;
  };
}

async function saveVoice(communicate, filename, report = () => {}) {
  const file = await fs.open(filename, 'wx');
  let bytes = 0;
  try {
    for await (const chunk of communicate.stream()) {
      if (chunk.type !== 'audio' || !chunk.data?.length) continue;
      // FileHandle.writeFile completes the write before resolving.
      await file.writeFile(chunk.data);
      if (!bytes) report({stage:'audio_received'});
      bytes += chunk.data.length;
      if (bytes > 8 * 1024 * 1024) throw Object.assign(new Error('Audio too large'), {code:'VOICE_INVALID_AUDIO'});
    }
    if (!bytes) throw Object.assign(new Error('Empty audio'), {code:'VOICE_NO_AUDIO'});
  } catch (error) {
    await file.close();
    await fs.unlink(filename).catch(() => {});
    throw error;
  }
  await file.close();
  report({stage:'complete'});
}

module.exports = {createVoiceTransport, saveVoice};
