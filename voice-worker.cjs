// Run synthesis outside the HTTP process so long text cannot block other requests.
const fs = require('node:fs');
const meSpeak = require('mespeak');
meSpeak.loadConfig(require('mespeak/src/mespeak_config.json'));
meSpeak.loadVoice(require('mespeak/voices/fr.json'));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => { input += part; if (input.length > 12000) process.exit(1); });
process.stdin.on('end', () => {
  try {
    const { text, gender } = JSON.parse(input);
    if (typeof text !== 'string' || !text.trim() || text.length > 800) throw Error('Invalid text');
    const wav = meSpeak.speak(text, { rawdata: 'buffer', voice: 'fr', variant: gender === 'female' ? 'f2' : 'm3', speed: 165, amplitude: 100 });
    if (!Buffer.isBuffer(wav) || wav.length < 44) throw Error('No audio');
    fs.writeFileSync(process.argv[2], wav);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
