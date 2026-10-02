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

  female_fr_brigitte: "fr-FR-BrigitteNeural",
  female_fr_celeste: "fr-FR-CelesteNeural",
  female_fr_corali: "fr-FR-CoralieNeural",
  female_fr_jacqueline: "fr-FR-JacquelineNeural",

  male: "fr-CA-AntoineNeural",
  male_ca_jean: "fr-CA-JeanNeural",
  male_ca_thierry: "fr-CA-ThierryNeural",

  male_fr: "fr-FR-HenriNeural",
  male_fr_alain: "fr-FR-AlainNeural",
  male_fr_claude: "fr-FR-ClaudeNeural",
  male_fr_jerome: "fr-FR-JeromeNeural",
     // English — Canada
  female_en_ca: "en-CA-ClaraNeural",
  male_en_ca: "en-CA-LiamNeural",

  // English — United States
  female_en_us_ava: "en-US-AvaNeural",
  female_en_us_jenny: "en-US-JennyNeural",
  female_en_us_aria: "en-US-AriaNeural",
  male_en_us_andrew: "en-US-AndrewNeural",
  male_en_us_guy: "en-US-GuyNeural",
  male_en_us_davis: "en-US-DavisNeural",

  // English — United Kingdom
  female_en_gb_sonia: "en-GB-SoniaNeural",
  female_en_gb_libby: "en-GB-LibbyNeural",
  male_en_gb_ryan: "en-GB-RyanNeural",
  male_en_gb_thomas: "en-GB-ThomasNeural"
};

const voice = voices[gender] || voices.female;

    const communicate = new Communicate(text.trim(), voice);

    await communicate.save(process.argv[2]);

  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
});
