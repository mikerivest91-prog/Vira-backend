import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import RunwayML from "@runwayml/sdk";
const app = express();
const port = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));
const API_KEY = process.env.OPENAI_API_KEY;
const VIDEO_PROVIDER = process.env.VIDEO_PROVIDER || "disabled";
const RUNWAY_API_KEY = process.env.RUNWAYML_API_SECRET;
  async function prepareVerticalImage(imageUrl) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "vira-image-")
  );

  const inputPath = path.join(tempDir, "input-image");
  const outputPath = path.join(tempDir, "vertical.png");

  try {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error("Impossible de télécharger l'image.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(inputPath, buffer);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        "-y",
        "-i", inputPath,
        "-vf",
        "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",
        outputPath
      ]);

      ffmpeg.on("close", code => {
        if (code === 0) resolve();
        else reject(new Error("Erreur lors du redimensionnement de l'image."));
      });

      ffmpeg.on("error", reject);
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, {
      recursive: true,
      force: true
    });
  }
  }
async function generateVideoClip(scene, imageBuffer) {
  if (!scene || !Buffer.isBuffer(imageBuffer)) {
    throw new Error("Scène ou image vidéo invalide.");
  }

  if (VIDEO_PROVIDER === "disabled") {
    return {
      scene,
      imageBuffer,
      provider: "disabled",
      status: "prepared"
    };
  }
if (VIDEO_PROVIDER === "runway") {
  if (!RUNWAY_API_KEY) {
    throw new Error("Clé API Runway manquante.");
  }
const imageDataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;
  return {
    scene,
    imageDataUrl,
    provider: "runway",
    status: "ready"
  };
}
  throw new Error(
    `Moteur vidéo non configuré : ${VIDEO_PROVIDER}`
  );
}
async function mergeVideoAndAudio(videoBuffer, audioBuffer) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "vira-")
  );

  const videoPath = path.join(tempDir, "video.mp4");
  const audioPath = path.join(tempDir, "audio.mp3");
  const outputPath = path.join(tempDir, "final.mp4");

  try {
    await fs.writeFile(videoPath, videoBuffer);
    await fs.writeFile(audioPath, audioBuffer);

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        outputPath
      ]);

      let errorOutput = "";

      ffmpeg.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on("error", reject);

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `FFmpeg a échoué (${code}): ${errorOutput}`
            )
          );
        }
      });
    });

    return await fs.readFile(outputPath);

  } finally {
    await fs.rm(tempDir, {
      recursive: true,
      force: true
    });
  }
}
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VIRA backend",
    version: "1.0.0",
    openai: Boolean(API_KEY)
  });
});

app.post("/api/images/generate", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured on Render."
      });
    }

    const {
      prompt,
      size = "1024x1536",
      quality = "low"
    } = req.body || {};

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: "A valid image prompt is required."
      });
    }

    console.log("VIRA IMAGE REQUEST:", prompt.trim());

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: `${prompt.trim()}\n\nIMPORTANT: Generate a clean professional image with absolutely no text, words, letters, captions, subtitles, slogans, logos, watermarks or typography anywhere in the image.`,
          size,
          quality
        })
      }
    );

    const data = await response.json();

    console.log(
      "OPENAI STATUS:",
      response.status
    );

    if (!response.ok) {
      console.error(
        "OPENAI ERROR:",
        JSON.stringify(data)
      );

      return res.status(response.status).json({
        ok: false,
        error:
          data?.error?.message ||
          "OpenAI image generation failed."
      });
    }

    const image = data?.data?.[0]?.b64_json;

    if (!image) {
      console.error(
        "OPENAI NO IMAGE:",
        JSON.stringify(data)
      );

      return res.status(502).json({
        ok: false,
        error: "OpenAI returned no image."
      });
    }
const imageUrl = `data:image/png;base64,${image}`;
 console.log("VIRA IMAGE CREATED");

return res.json({
  ok: true,
  url: imageUrl,
  image: {
    url: imageUrl
  }
});

} catch (error) {
  console.error("VIRA SERVER ERROR:", error);

  return res.status(500).json({
    ok: false,
    error: error?.message || "Erreur serveur."
  });
}

});
// ===============================
// VIRA - GENERATION DE SCENARIO
// ===============================

app.post("/api/scenario/generate", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured on Render."
      });
    }

const allowedMarketingTypes = [
  "🛍️ Vendre un produit",
  "💼 Promouvoir un service",
  "📱 Réseaux sociaux",
  "📢 Créer une publicité",
  "Campagne marketing générale"
];

const {
  idea,
  marketingType = "Campagne marketing générale",
  businessName = "",
  marketingGoal = "",
  targetAudience = "",
  platform = ""
} = req.body;
const safeMarketingType = allowedMarketingTypes.includes(marketingType)
  ? marketingType
  : "Campagne marketing générale";
    if (typeof idea !== "string" || !idea.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Une idée est requise."
      });
    }

    console.log("VIRA SCENARIO REQUEST:", idea.trim());

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: `
Tu es VIRA Marketing IA, un expert en marketing digital, publicité et création de contenu vidéo à fort potentiel de conversion.

À partir de cette entreprise, ce produit ou ce service :
"${idea.trim()}"

Type de campagne marketing choisi :
"${safeMarketingType}"
INFORMATIONS MARKETING :
Nom de l'entreprise ou du produit : "${businessName || "Non précisé"}"
Objectif marketing : "${marketingGoal || "Non précisé"}"
Public cible : "${targetAudience || "Non précisé"}"
Plateforme : "${platform || "Non précisée"}"
Crée une campagne vidéo marketing courte, persuasive et professionnelle adaptée précisément au type de campagne choisi.

OBJECTIFS :
- capter l'attention dès les premières secondes
- présenter clairement le produit, service ou message
- mettre en avant un bénéfice concret pour le client
- créer de l'intérêt et du désir
- terminer avec un appel à l'action clair
- produire des scènes visuelles adaptées aux réseaux sociaux et à la publicité
- garder une continuité parfaite entre les 5 scènes



ADAPTE LA STRATÉGIE AU TYPE CHOISI :

- Vendre un produit : mettre le produit au centre, montrer son principal bénéfice, créer du désir et terminer par un appel à l'achat.

- Promouvoir un service : présenter le problème du client, montrer comment le service le résout, mettre en valeur le résultat obtenu et terminer par un appel à prendre contact.

- Réseaux sociaux : privilégier un hook très fort, un rythme rapide, du contenu engageant et partageable, puis terminer par un appel à suivre, commenter ou partager.

- Créer une publicité : créer une publicité orientée conversion avec hook, problème, solution, bénéfice, preuve ou élément de confiance et appel à l'action.
RÈGLES MARKETING :
- La SCÈNE 1 doit contenir un hook puissant qui arrête le défilement.
- La SCÈNE 2 doit montrer clairement le problème ou le besoin du client.
- La SCÈNE 3 doit présenter le produit ou service comme solution.
- La SCÈNE 4 doit montrer le bénéfice ou le résultat concret.
- La SCÈNE 5 doit terminer avec un appel à l'action clair et convaincant.
- Évite les phrases génériques et les promesses exagérées.
- Chaque scène doit être visuellement différente mais conserver la même identité de marque.
- La narration doit être courte, naturelle et persuasive.
- Le contenu doit être conçu pour une vidéo verticale 9:16.
- Ne jamais écrire le format vidéo (9:16, 16:9, vertical ou horizontal) dans la description des SCÈNES. Le format vidéo doit apparaître uniquement dans la section STYLE.
IMPORTANT : Toutes les sections demandées doivent contenir du texte. Ne laisse aucune section vide.
FORMAT DE SORTIE OBLIGATOIRE.
Respecte exactement tous les titres ci-dessous, dans cet ordre.
Ne supprime aucune section.

TITRE:
[un titre marketing accrocheur]

OBJECTIF:
[objectif précis de la campagne]

PUBLIC CIBLE:
[public cible précis]

ACCROCHE:
[une accroche courte et puissante]

TEXTE PUBLICATION:
[texte prêt à publier sur la plateforme choisie]

HASHTAGS:
[8 à 12 hashtags pertinents]

SCÈNE 1:
[description visuelle détaillée]

SCÈNE 2:
[description visuelle détaillée]

SCÈNE 3:
Tu es VIRA Marketing IA, un directeur marketing senior spécialisé en publicité numérique, réseaux sociaux, copywriting, stratégie de conversion et création de vidéos courtes.

Ta mission est de créer une campagne marketing professionnelle, crédible, persuasive et directement exploitable.

INFORMATIONS FOURNIES PAR L'UTILISATEUR

Idée / entreprise / produit / service :
"${idea.trim()}"

Type de campagne :
"${safeMarketingType}"

Nom de l'entreprise ou du produit :
"${businessName || "Non précisé"}"

Objectif marketing :
"${marketingGoal || "Non précisé"}"

Public cible :
"${targetAudience || "Non précisé"}"

Plateforme :
"${platform || "Non précisée"}"

OBJECTIF PRINCIPAL

Construis une campagne capable de :
- capter l'attention immédiatement;
- communiquer une proposition de valeur claire;
- présenter un problème ou un désir réel du client;
- montrer concrètement comment l'offre apporte une solution;
- créer de l'intérêt et de la confiance;
- inciter à une action précise;
- être directement transformable en vidéo marketing verticale.

QUALITÉ MARKETING

La campagne doit être spécifique au produit, au service et au public cible.

Évite :
- les formulations génériques;
- les promesses irréalistes;
- les clichés marketing;
- les répétitions;
- les informations inventées;
- les affirmations qui ne peuvent pas être justifiées.

Privilégie :
- les bénéfices concrets;
- un langage naturel;
- une proposition de valeur facilement comprise;
- une accroche forte;
- un appel à l'action précis;
- une progression logique entre les scènes.

ADAPTATION AU TYPE DE CAMPAGNE

Si le type est "🛍️ Vendre un produit" :
mets le produit, son bénéfice principal, son utilisation et la transformation obtenue au centre de la campagne.

Si le type est "💼 Promouvoir un service" :
présente d'abord le problème ou le besoin du client, puis montre clairement comment le service le résout.

Si le type est "📱 Réseaux sociaux" :
privilégie un hook très rapide, un contenu dynamique, partageable et conçu pour retenir l'attention.

Si le type est "📣 Créer une publicité" :
construis une publicité orientée conversion avec problème, bénéfice, preuve visuelle et appel à l'action.

ADAPTATION À LA PLATEFORME

Si la plateforme est Instagram :
crée un contenu très visuel, esthétique, rapide et adapté aux Reels.

Si la plateforme est TikTok :
utilise un hook immédiat, un rythme très rapide et une narration naturelle.

Si la plateforme est Facebook :
mets l'accent sur la clarté de l'offre, la confiance et la conversion.

Si la plateforme est YouTube :
optimise la rétention, la progression narrative et la compréhension du message.

Si la plateforme est LinkedIn :
utilise un ton professionnel, crédible et orienté valeur ou résultat.

STRUCTURE VIDÉO

La vidéo comporte exactement 5 scènes.

SCÈNE 1 :
Hook visuel immédiat. Elle doit arrêter le défilement dans les premières secondes.

-  représenter UNE SEULE composition visuelle principale;
- ne jamais créer de collage, mosaïque, split-screen ou image divisée en plusieurs panneaux;
- ne jamais regrouper plusieurs plans ou plusieurs moments dans une même image;
- montrer un seul moment précis de la scène;
- utiliser un cadrage photographique unique, comme une vraie image publicitaire;
- conserver une continuité visuelle stricte des personnages, vêtements, produit, véhicule, couleurs et identité de marque entre les 5 scènes;
- être visuellement différente;
- rester cohérente avec les autres scènes;
- conserver les mêmes personnages, produit, marque et identité visuelle lorsqu'ils apparaissent;
- décrire précisément l'action, le décor, le cadrage et les éléments importants;
- être réalisable par une IA de génération d'images ou de vidéos.
- ne jamais intégrer de texte, slogan, sous-titre, CTA, logo ou typographie directement dans l'image; VIRA ajoutera ces éléments séparément;

NARRATION

La narration doit :
- correspondre aux 5 scènes;
- être naturelle et persuasive;
- utiliser des phrases courtes;
- éviter le langage robotique;
- être adaptée à une vidéo courte;
- renforcer l'image plutôt que simplement la décrire.

TEXTE DE PUBLICATION

Le texte doit être prêt à copier-coller sur la plateforme choisie.

Il doit :
- commencer par une phrase qui attire l'attention;
- présenter clairement le bénéfice;
- rester naturel;
- terminer par un appel à l'action;
- être adapté au public cible et à la plateforme.

HASHTAGS

Produis entre 8 et 12 hashtags réellement pertinents.
Évite les hashtags sans rapport avec l'offre.

PROMPT VISUEL

Cette section est OBLIGATOIRE et ne doit jamais être vide.

Écris un prompt visuel professionnel permettant de reproduire la campagne avec une IA générative.

Le prompt doit préciser :
- les sujets principaux;
- le produit ou service;
- l'environnement;
- les actions;
- le cadrage et les angles de caméra;
- l'éclairage;
- les couleurs;
- l'ambiance;
- le niveau de réalisme;
- la continuité visuelle entre les scènes;
- le format vertical 9:16;
- les éléments de marque utiles.

IMPORTANT

Toutes les sections ci-dessous doivent obligatoirement contenir du texte.

Ne supprime aucune section.
Ne renomme aucun titre.
Respecte exactement l'ordre demandé.
N'utilise pas de Markdown autour des titres.
Ne mets pas les titres en gras.
Ne rajoute aucune section supplémentaire.

FORMAT DE SORTIE OBLIGATOIRE

TITRE:
[un titre marketing spécifique, mémorable et accrocheur]

OBJECTIF:
[objectif concret de cette campagne]

PUBLIC CIBLE:
[description précise du public cible]

ACCROCHE:
[une accroche courte, puissante et spécifique]

TEXTE PUBLICATION:
[texte complet prêt à publier]

HASHTAGS:
[8 à 12 hashtags pertinents]

SCÈNE 1:
[description visuelle détaillée de la scène 1]

SCÈNE 2:
[description visuelle détaillée de la scène 2]

SCÈNE 3:
[description visuelle détaillée de la scène 3]

SCÈNE 4:
[description visuelle détaillée de la scène 4]

SCÈNE 5:
[description visuelle détaillée de la scène 5]

NARRATION:
[narration complète correspondant aux cinq scènes]

APPEL À L'ACTION:
[appel à l'action clair, naturel et adapté à l'objectif]

PROMPT VISUEL:
[prompt visuel complet et détaillé, exploitable par une IA générative]

STYLE:
[direction artistique : style visuel, format, rythme, ambiance, couleurs, éclairage et montage]
          `.trim()
        })
      }
    );

    const data = await response.json();

    console.log("OPENAI SCENARIO STATUS:", response.status);

    if (!response.ok) {
      console.error("OPENAI SCENARIO ERROR:", JSON.stringify(data));

      return res.status(response.status).json({
        ok: false,
        error:
          data?.error?.message ||
          "La génération du scénario a échoué."
      });
    }

const scenario =
  data?.output_text ||
  data?.output
    ?.flatMap(item => item?.content || [])
    ?.find(item => item?.type === "output_text")
    ?.text ||
  "";

    if (!scenario) {
      return res.status(502).json({
        ok: false,
        error: "OpenAI n'a retourné aucun scénario."
      });
    }

    console.log(
  "VIRA SCENARIO RECEIVED:",
  safeMarketingType
);

return res.json({
  ok: true,
  scenario,
  marketingType: safeMarketingType
});

  } catch (error) {
    console.error("VIRA SCENARIO SERVER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erreur interne du serveur."
    });
  }
});
app.post("/api/video/generate", async (req, res) => {
  try {
    const { prompt, images = [] } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: "A valid video prompt is required."
      });
    }
    const scenes = prompt
  .split(/SC[ÈE]NE\s*[1-5]\s*:/i)
  .slice(1, 6)
  .map(scene => scene.trim())
  .filter(Boolean);
if (!Array.isArray(images)) {
  return res.status(400).json({
    ok: false,
    error: "Images invalides."
  });
}
    
if (scenes.length !== 5 || images.length !== 5) {
  return res.status(400).json({
    ok: false,
    error: "VIRA a besoin de 5 scènes et 5 images pour créer la vidéo."
  });
}
    const preparedImages = [];

for (const imageUrl of images) {
  const preparedImage = await prepareVerticalImage(imageUrl);
  preparedImages.push(preparedImage);
}
    const videoClips = [];

for (let i = 0; i < 5; i++) {
  const clip = await generateVideoClip(
    scenes[i],
    preparedImages[i]
  );

  videoClips.push(clip);
}
    console.log("VIRA VIDEO REQUEST:", prompt.trim());

    return res.json({
  ok: true,
  status: "prepared",
      provider: VIDEO_PROVIDER,
  clips: videoClips.map((clip, index) => ({
    scene: index + 1,
    ready: true
  }))
});

  } catch (error) {
    console.error("VIRA VIDEO ERROR:", error);

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erreur interne du serveur."
    });
  }
});


// ================================
// GÉNÉRER LA VOIX
// ================================
app.post("/api/voice/generate", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured."
      });
    }

    const { text } = req.body || {};

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Un texte est requis pour générer la voix."
      });
    }

    if (text.trim().length > 4096) {
      return res.status(400).json({
        ok: false,
        error: "Le texte est trop long pour une seule génération de voix."
      });
    }
const shortText = text
  .trim()
  .split(/\s+/)
  .slice(0, 18)
  .join(" ");
    
   console.log("VIRA VOICE REQUEST:", shortText);

    const response = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "cedar",
          input: shortText,
          response_format: "mp3"
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));

      return res.status(response.status).json({
        ok: false,
        error:
          errorData?.error?.message ||
          "Erreur lors de la génération de la voix."
      });
    }

    const audioBuffer = Buffer.from(
      await response.arrayBuffer()
    );

    console.log(
      "VIRA VOICE CREATED:",
      audioBuffer.length,
      "bytes"
    );

    res.set("Content-Type", "audio/mpeg");
    res.set("Content-Disposition", 'inline; filename="VIRA-voice.mp3"');

    return res.send(audioBuffer);

  } catch (error) {
    console.error("VIRA VOICE ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "Erreur interne de génération de voix."
    });
  }
});
app.listen(port, "0.0.0.0", () => {
  console.log(`VIRA backend running on port ${port}`);
});
