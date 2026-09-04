import "dotenv/config";
import express from "express";
import cors from "cors";
import RunwayML from "@runwayml/sdk";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
// ======================================================
// VIRA MARKETING IA — BACKEND
// ======================================================

const app = express();
const port = Number(process.env.PORT || 10000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RUNWAY_API_KEY = process.env.RUNWAYML_API_SECRET;

const VIDEO_PROVIDER =
  process.env.VIDEO_PROVIDER || "disabled";

const runway = RUNWAY_API_KEY
  ? new RunwayML()
  : null;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());

app.use(
  express.json({
    limit: "25mb"
  })
);

app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});


// ======================================================
// OUTILS
// ======================================================

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function extractOutputText(data) {
  if (
    typeof data?.output_text === "string" &&
    data.output_text.trim()
  ) {
    return data.output_text.trim();
  }

  if (!Array.isArray(data?.output)) {
    return "";
  }

  for (const item of data.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (
        content?.type === "output_text" &&
        typeof content?.text === "string"
      ) {
        return content.text.trim();
      }
    }
  }

  return "";
}

function extractScenes(text) {
  if (typeof text !== "string") {
    return [];
  }

  const scenes = [];

  const regex =
    /SC[ÈE]NE\s*([1-3])\s*:\s*([\s\S]*?)(?=SC[ÈE]NE\s*[1-3]\s*:|NARRATION\s*:|APPEL À L['’]ACTION\s*:|PROMPT VISUEL\s*:|STYLE\s*:|$)/gi;

  let match;

  while ((match = regex.exec(text)) !== null) {
    scenes.push({
      number: Number(match[1]),
      text: cleanText(match[2])
    });
  }

  return scenes
    .sort((a, b) => a.number - b.number)
    .slice(0, 3);
}

// ======================================================
// ACCUEIL / TEST SERVEUR
// ======================================================



app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VIRA Marketing IA",
    openaiConfigured: Boolean(OPENAI_API_KEY),
    runwayConfigured: Boolean(RUNWAY_API_KEY),
    videoProvider: VIDEO_PROVIDER
  });
});

// ======================================================
// GÉNÉRATION DU SCÉNARIO MARKETING
// ======================================================

app.post("/api/scenario/generate", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        ok: false,
        error:
          "OPENAI_API_KEY n'est pas configurée."
      });
    }

    const {
      idea,
      marketingType,
      businessName,
      marketingGoal,
      targetAudience,
      platform
    } = req.body || {};

    const safeIdea = cleanText(idea);

    if (!safeIdea) {
      return res.status(400).json({
        ok: false,
        error: "Une idée est requise."
      });
    }

    const safeMarketingType =
      cleanText(marketingType) ||
      "Campagne marketing générale";

    const safeBusinessName =
      cleanText(businessName) ||
      "Non précisé";

    const safeMarketingGoal =
      cleanText(marketingGoal) ||
      "Non précisé";

    const safeTargetAudience =
      cleanText(targetAudience) ||
      "Non précisé";

    const safePlatform =
      cleanText(platform) ||
      "Non précisée";
const removeAIReferences = (text = "") =>
  text
    .replace(/\bintelligence artificielle\b/gi, "")
    .replace(/\bIA\b/gi, "")
    .replace(/\bAI\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const brandSafeIdea = removeAIReferences(safeIdea);
const brandSafeBusinessName = removeAIReferences(safeBusinessName);
const brandSafeMarketingGoal = removeAIReferences(safeMarketingGoal);
const brandSafeTargetAudience = removeAIReferences(safeTargetAudience);
    const prompt = `
Tu es VIRA, une plateforme marketing professionnelle haut de gamme.
RÈGLE DE MARQUE IMPORTANTE :
- Ne jamais utiliser les mots "IA", "intelligence artificielle" ou "AI" dans les textes destinés au client.
- Présenter VIRA comme une plateforme marketing professionnelle.
- Si les informations fournies mentionnent l'IA, reformuler naturellement sans reprendre ce terme.
- Mettre l'accent sur les bénéfices : gain de temps, croissance, conversion, création de contenu et performance marketing.
Tu es un directeur marketing senior spécialisé en :
- marketing numérique
- publicité
- réseaux sociaux
- copywriting
- stratégie de conversion
- création de vidéos publicitaires courtes

Ta mission est de transformer les informations fournies par l'utilisateur en une campagne vidéo marketing professionnelle, crédible, persuasive et directement exploitable.

INFORMATIONS FOURNIES

Produit / service :
"${brandSafeIdea}"

Type de campagne :
"${safeMarketingType}"

Nom de l'entreprise ou du produit :
"${brandSafeBusinessName}"
Objectif marketing :
"${brandSafeMarketingGoal}"

Public cible :
"${brandSafeTargetAudience}"
Plateforme :
"${safePlatform}"

OBJECTIF PRINCIPAL

Construis une campagne capable de :
- capter immédiatement l'attention;
- communiquer une proposition de valeur claire;
- présenter un problème, un besoin ou un désir réel;
- montrer comment le produit ou service apporte une solution;
- créer de l'intérêt et de la confiance;
- inciter à une action précise;
- être directement transformable en vidéo marketing courte.

ADAPTATION AU TYPE DE CAMPAGNE

Si le type concerne la vente d'un produit :
- mets le produit au centre;
- montre son utilisation;
- insiste sur son bénéfice principal;
- termine avec un appel à l'action.

Si le type concerne la promotion d'un service :
- commence par le problème ou besoin du client;
- présente le service comme solution;
- montre un résultat crédible.

Si le type concerne les réseaux sociaux :
- utilise un hook très rapide;
- privilégie un contenu dynamique;
- optimise la rétention.

Si le type concerne une publicité :
- construis une publicité orientée conversion;
- présente clairement l'offre;
- termine avec un CTA fort.

ADAPTATION À LA PLATEFORME

Instagram :
contenu esthétique, visuel, rapide et engageant.

TikTok :
hook immédiat, rythme rapide, contenu naturel et dynamique.

Facebook :
clarté de l'offre, confiance et bénéfice concret.

YouTube :
rétention, progression narrative et conclusion forte.

LinkedIn :
ton professionnel, crédible et orienté valeur.

STRUCTURE VIDÉO

La campagne comporte EXACTEMENT 3 scènes.

SCÈNE 1 :
Hook visuel immédiat.
La scène doit arrêter le défilement et susciter la curiosité.

SCÈNE 2 :
Montre clairement le problème, le besoin ou le désir du client.

SCÈNE 3 :
Présente le produit ou service comme solution.



RÈGLES VISUELLES

Chaque scène doit :
- représenter UNE SEULE composition visuelle;
- montrer un seul moment précis;
- avoir un cadrage photographique unique;
- être visuellement différente des autres scènes;
- rester cohérente avec les autres scènes;
- être réalisable par une IA de génération d'images;
- décrire précisément l'action;
- décrire précisément le décor;
- décrire précisément le cadrage;
- décrire l'éclairage et l'ambiance.

INTERDIT :
- collage;
- mosaïque;
- split-screen;
- plusieurs plans dans une même image;
- texte intégré dans l'image;
- sous-titres dans l'image;
- slogan écrit dans l'image;
- CTA écrit dans l'image;
- watermark;
- logo inventé.

CONTINUITÉ VISUELLE

Si une personne apparaît dans plusieurs scènes, conserve :
- la même personne;
- le même visage;
- le même âge approximatif;
- la même coiffure;
- les mêmes vêtements;
- les mêmes accessoires.

Si un produit apparaît dans plusieurs scènes, conserve :
- le même produit;
- la même forme;
- les mêmes couleurs;
- le même design;
- les mêmes détails visibles.

QUALITÉ MARKETING

Évite :
- les formulations génériques;
- les clichés marketing;
- les répétitions;
- les promesses irréalistes;
- les informations inventées;
- les affirmations impossibles à justifier.

Privilégie :
- une proposition de valeur précise;
- un bénéfice concret;
- une accroche forte;
- un langage naturel;
- un appel à l'action précis;
- une progression logique entre les scènes.

NARRATION

La narration doit :
- correspondre aux 3 scènes;
- être courte;
- être naturelle;
- être persuasive;
- utiliser des phrases faciles à prononcer;
- éviter le langage robotique;
- être adaptée à une vidéo marketing courte.

TEXTE DE PUBLICATION

Le texte doit être prêt à copier-coller sur la plateforme choisie.

Il doit :
- commencer par une phrase attirant l'attention;
- présenter clairement le bénéfice;
- rester naturel;
- être adapté au public cible;
- être adapté à la plateforme;
- terminer par un appel à l'action.

HASHTAGS

Produis entre 8 et 12 hashtags réellement pertinents.

N'utilise pas de hashtags sans rapport avec l'offre.

PROMPT VISUEL

Crée un prompt visuel global professionnel destiné à maintenir la cohérence des images générées.

Il doit préciser :
- les sujets principaux;
- le produit ou service;
- l'environnement;
- les personnages;
- les vêtements si nécessaire;
- les actions;
- le cadrage;
- les angles de caméra;
- l'éclairage;
- les couleurs;
- l'ambiance;
- le niveau de réalisme;
- la continuité visuelle;
- l'esthétique publicitaire premium;
- le format vertical 9:16.
- Utilise le format vertical 9:16 pour la composition, mais ne mentionne jamais "9:16", "format 9:16" ou les dimensions du format dans le texte des scènes destiné à l'utilisateur.
FORMAT DE SORTIE OBLIGATOIRE

Respecte EXACTEMENT les titres suivants.

Toutes les sections doivent contenir du texte.

Ne supprime aucune section.
Ne renomme aucun titre.
Ne rajoute aucune section.
N'utilise pas de Markdown autour des titres.

TITRE:
[titre marketing spécifique]

OBJECTIF:
[objectif concret de la campagne]

PUBLIC CIBLE:
[public cible précis]

ACCROCHE:
[accroche courte et puissante]

TEXTE PUBLICATION:
[texte complet prêt à publier]

HASHTAGS:
[8 à 12 hashtags pertinents]

SCÈNE 1:
[description visuelle détaillée]

SCÈNE 2:
[description visuelle détaillée]

SCÈNE 3:
[description visuelle détaillée]


NARRATION:
[narration complète correspondant aux 3 scènes]

APPEL À L'ACTION:
[appel à l'action clair]

PROMPT VISUEL:
[prompt visuel professionnel assurant la continuité]

STYLE:
[direction artistique, ambiance, couleurs, éclairage, réalisme, esthétique publicitaire premium]
`.trim();

    console.log(
      "VIRA SCENARIO REQUEST:",
      safeIdea
    );

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-5.4",
          input: prompt
        })
      }
    );

    const data =
      await response
        .json()
        .catch(() => ({}));

    console.log(
      "OPENAI SCENARIO STATUS:",
      response.status
    );

    if (!response.ok) {
      console.error(
        "OPENAI SCENARIO ERROR:",
        JSON.stringify(data)
      );

      return res
        .status(response.status)
        .json({
          ok: false,
          error:
            data?.error?.message ||
            "Erreur lors de la génération du scénario."
        });
    }

    let scenario =
  extractOutputText(data);

if (!scenario) {
  return res.status(502).json({
    ok: false,
    error: "Aucun scénario reçu."
  });
}

// Protection finale de la marque VIRA
scenario = scenario
  .replace(/\bintelligence artificielle\b/gi, "technologie")
  .replace(/\bIA\b/gi, "")
  .replace(/\bAI\b/gi, "")
  .replace(/[ \t]{2,}/g, " ")
  .trim();

const scenes =
  extractScenes(scenario);

return res.json({
  ok: true,
  scenario,
  scenes
});

  } catch (error) {
    console.error(
      "VIRA SCENARIO ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erreur interne du serveur."
    });
  }
});

// ======================================================
// GÉNÉRATION D'UNE IMAGE
// ======================================================

app.post("/api/images/generate", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        ok: false,
        error:
          "OPENAI_API_KEY n'est pas configurée."
      });
    }

    const {
      prompt,
      size = "1024x1536",
      quality = "low"
    } = req.body || {};

    const safePrompt =
      cleanText(prompt);

    if (!safePrompt) {
      return res.status(400).json({
        ok: false,
        error:
          "Un prompt image est requis."
      });
    }

    const finalPrompt = `
${safePrompt}

Create exactly ONE coherent advertising image.

Requirements:
- vertical advertising composition
- one single moment
- professional commercial photography
- visually realistic
- premium lighting
- coherent subject
- coherent product appearance

Do NOT create:
- collage
- mosaic
- split-screen
- multiple panels
- text
- letters
- subtitles
- captions
- slogans
- watermarks
- invented logos
`.trim();

    console.log(
      "VIRA IMAGE REQUEST"
    );

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: finalPrompt,
          size,
          quality
        })
      }
    );

    const data =
      await response
        .json()
        .catch(() => ({}));

    console.log(
      "OPENAI IMAGE STATUS:",
      response.status
    );

    if (!response.ok) {
      console.error(
        "OPENAI IMAGE ERROR:",
        JSON.stringify(data)
      );

      return res
        .status(response.status)
        .json({
          ok: false,
          error:
            data?.error?.message ||
            "Erreur lors de la génération de l'image."
        });
    }

    const imageBase64 =
      data?.data?.[0]?.b64_json;

    const imageUrl =
      data?.data?.[0]?.url;

    if (!imageBase64 && !imageUrl) {
      return res.status(502).json({
        ok: false,
        error:
          "Aucune image reçue d'OpenAI."
      });
    }

    const url =
      imageBase64
        ? `data:image/png;base64,${imageBase64}`
        : imageUrl;

    return res.json({
      ok: true,
      url,
      image: {
        url
      }
    });

  } catch (error) {
    console.error(
      "VIRA IMAGE ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erreur interne de génération d'image."
    });
  }
});

// ======================================================
// GÉNÉRATION VIDÉO RUNWAY
// ======================================================

app.post("/api/video/generate", async (req, res) => {
  try {
    const {
      prompt,
      images = []
    } = req.body || {};

    const safePrompt =
      cleanText(prompt);

    if (!safePrompt) {
      return res.status(400).json({
        ok: false,
        error:
          "Un scénario est requis pour créer la vidéo."
      });
    }

    if (!Array.isArray(images)) {
      return res.status(400).json({
        ok: false,
        error:
          "La liste des images est invalide."
      });
    }

    const scenes =
      extractScenes(safePrompt);

    if (scenes.length !== 3) {
      return res.status(400).json({
        ok: false,
        error:
          "VIRA a besoin de exactement 3 scènes."
      });
    }

    if (images.length !== 3) {
      return res.status(400).json({
        ok: false,
        error:
          "VIRA a besoin de exactement 3 images."
      });
    }

    if (VIDEO_PROVIDER === "disabled") {
      return res.json({
        ok: true,
        status: "prepared",
        provider: "disabled",
        message:
          "Les 3 scènes et les 3 images sont prêtes."
      });
    }

    if (VIDEO_PROVIDER !== "runway") {
      return res.status(503).json({
        ok: false,
        error:
          `Moteur vidéo inconnu : ${VIDEO_PROVIDER}`
      });
    }

    if (!runway) {
      return res.status(503).json({
        ok: false,
        error:
          "Runway n'est pas configuré."
      });
    }

    const clips = [];

    for (let i = 0; i < 3; i++) {
      const image =
        cleanText(images[i]);

      if (!image) {
        return res.status(400).json({
          ok: false,
          error:
            `Image ${i + 1} manquante.`
        });
      }

      const task =
        await runway.imageToVideo.create({
          model: "gen4_turbo",
          promptImage: image,
          promptText:
            scenes[i].text,
          ratio: "720:1280",
          duration: 5
        });

      clips.push({
        scene: i + 1,
        taskId: task.id,
        status: "submitted"
      });
    }

    return res.json({
      ok: true,
      provider: "runway",
      status: "submitted",
      clips
    });

  } catch (error) {
    console.error(
      "VIRA VIDEO ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erreur lors de la création vidéo."
    });
  }
});

// ======================================================
// STATUT D'UNE VIDÉO RUNWAY
// ======================================================

app.get(
  "/api/video/:taskId/status",
  async (req, res) => {
    try {
      if (!runway) {
        return res.status(503).json({
          ok: false,
          error:
            "Runway n'est pas configuré."
        });
      }

      const taskId =
        cleanText(req.params.taskId);

      if (!taskId) {
        return res.status(400).json({
          ok: false,
          error:
            "Task ID manquant."
        });
      }

      const task =
        await runway.tasks.retrieve(
          taskId
        );

      return res.json({
        ok: true,
        taskId: task.id,
        status: task.status,
        output:
          Array.isArray(task.output)
            ? task.output
            : []
      });

    } catch (error) {
      console.error(
        "VIRA RUNWAY STATUS ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          error?.message ||
          "Impossible de vérifier la vidéo."
      });
    }
  }
);

// ======================================================
// GÉNÉRATION DE LA VOIX
// ======================================================

app.post("/api/voice/generate", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(503).json({
        ok: false,
        error:
          "OPENAI_API_KEY n'est pas configurée."
      });
    }

    const text =
      cleanText(req.body?.text);

    if (!text) {
      return res.status(400).json({
        ok: false,
        error:
          "Un texte est requis pour générer la voix."
      });
    }

    if (text.length > 4096) {
      return res.status(400).json({
        ok: false,
        error:
          "Le texte est trop long."
      });
    }

    console.log(
      "VIRA VOICE REQUEST"
    );

    const response = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "cedar",
          input: text,
          response_format: "mp3"
        })
      }
    );

    if (!response.ok) {
      const errorData =
        await response
          .json()
          .catch(() => ({}));

      return res
        .status(response.status)
        .json({
          ok: false,
          error:
            errorData?.error?.message ||
            "Erreur lors de la génération de la voix."
        });
    }

    const audioBuffer =
      Buffer.from(
        await response.arrayBuffer()
      );

    res.set(
      "Content-Type",
      "audio/mpeg"
    );

    res.set(
      "Content-Disposition",
      'inline; filename="vira-voice.mp3"'
    );

    return res.send(
      audioBuffer
    );

  } catch (error) {
    console.error(
      "VIRA VOICE ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Erreur interne de génération de voix."
    });
  }
});

// ======================================================
// ERREUR 404 API
// ======================================================

app.use("/api", (req, res) => {
  return res.status(404).json({
    ok: false,
    error: `Route introuvable : ${req.method} ${req.originalUrl}`
  });
});

// ======================================================
// DÉMARRAGE
// ======================================================

app.listen(port, "0.0.0.0", () => {
  console.log(
    `VIRA backend running on port ${port}`
  );
});
