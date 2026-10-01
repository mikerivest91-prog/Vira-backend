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

    const { Communicate } = await import("edge-tts.js");

   const voices = {
  female: "fr-CA-SylvieNeural",
  female_fr: "fr-FR-DeniseNeural",
  male: "fr-CA-AntoineNeural",
  male_fr: "fr-FR-HenriNeural"
};

const voice = voices[gender] || voices.female;

    const communicate = new Communicate(text.trim(), voice);

    await communicate.save(process.argv[2]);

  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
});
