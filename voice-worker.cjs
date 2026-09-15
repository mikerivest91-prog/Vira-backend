const fs = require("node:fs");

let input = "";

process.stdin.setEncoding("utf8");

process.stdin.on("data", part => {
  input += part;
  if (input.length > 12000) process.exit(1);
});

process.stdin.on("end", async () => {
  try {
    const { text, gender } = JSON.parse(input);

    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 800
    ) {
      throw new Error("Invalid text");
    }

    const { EdgeTTS } = await import("edge-tts.js");

    const voice =
      gender === "female"
        ? "fr-CA-SylvieNeural"
        : "fr-CA-AntoineNeural";

    const tts = new EdgeTTS(text, voice);

    await tts.ttsPromise;

    const audio = tts.audio;

    if (!audio || !audio.length) {
      throw new Error("No audio generated");
    }

    fs.writeFileSync(process.argv[2], audio);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
});
