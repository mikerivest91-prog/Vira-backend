import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const API_KEY = process.env.OPENAI_API_KEY;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "VIRA backend",
    version: "1.0.0",
    openai: Boolean(API_KEY)
  });
});
app.post("/api/scenario/generate", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured."
      });
    }

    const { idea } = req.body || {};

    if (typeof idea !== "string" || !idea.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Une idée est requise."
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        input: `Crée un scénario court et captivant à partir de cette idée :

${idea.trim()}

Structure le scénario en 5 scènes.
Pour chaque scène indique :
- la scène
- l'action
- le lieu
- l'ambiance

Réponds en français.`
      })
    });

  const data = await response.json();

if (!response.ok) {
  console.error("OPENAI SCENARIO ERROR:", JSON.stringify(data));

  return res.status(response.status).json({
    ok: false,
    error: data?.error?.message || "Erreur lors de la création du scénario."
  });
}

const scenario =
  data?.output_text ||
  data?.output?.find(x => x.type === "message")
    ?.content?.find(x => x.type === "output_text")
    ?.text ||
  data?.output?.[0]?.content?.find(x => typeof x.text === "string")
    ?.text ||
  "";

console.log("VIRA SCENARIO DATA:", JSON.stringify(data, null, 2));
console.log("VIRA SCENARIO TEXT:", scenario);

if (!scenario) {
  return res.status(500).json({
    ok: false,
    error: "Aucun texte de scénario reçu d'OpenAI."
  });
}  
return res.json({
  ok: true,
  scenario: scenario,
  output_text: scenario
});
  } catch (error) {
    console.error("VIRA SCENARIO ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "Erreur serveur."
    });
  }
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
          prompt: prompt.trim(),
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

    const { idea } = req.body || {};

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
Tu es le scénariste de VIRA, une application de création vidéo avec intelligence artificielle.

À partir de cette idée :
"${idea.trim()}"

Crée un scénario court et visuel destiné à une vidéo verticale.

Réponds exactement avec cette structure :

TITRE:
[un titre accrocheur]

SCÈNE 1:
[description visuelle]

SCÈNE 2:
[description visuelle]

SCÈNE 3:
[description visuelle]

SCÈNE 4:
[description visuelle]

SCÈNE 5:
[description visuelle]

NARRATION:
[texte court de narration]

STYLE:
[style visuel recommandé]

Le scénario doit être dynamique, facile à transformer en images et en vidéo.
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

    const scenario = data?.output_text;

    if (!scenario) {
      return res.status(502).json({
        ok: false,
        error: "OpenAI n'a retourné aucun scénario."
      });
    }

    console.log("VIRA SCENARIO RECEIVED: YES");

    return res.json({
      ok: true,
      scenario
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
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "OPENAI_API_KEY is not configured."
      });
    }

    const { prompt } = req.body || {};

    if (typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: "A valid video prompt is required."
      });
    }

    console.log("VIRA VIDEO REQUEST:", prompt.trim());

    // 1. Créer le job vidéo
    const response = await fetch(
      "https://api.openai.com/v1/videos",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: "sora-2",
          prompt: prompt.trim(),
          size: "720x1280",
          seconds: "8"
        })
      }
    );

    const data = await response.json();

    console.log("VIRA VIDEO CREATED:", data);

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data?.error?.message || "Erreur lors de la création de la vidéo."
      });
    }

    if (!data?.id) {
      return res.status(500).json({
        ok: false,
        error: "Aucun identifiant vidéo reçu du serveur OpenAI."
      });
    }

    // 2. Attendre que la vidéo soit terminée
    let video = data;

    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5000));

      const statusResponse = await fetch(
        `https://api.openai.com/v1/videos/${data.id}`,
        {
          headers: {
            "Authorization": `Bearer ${API_KEY}`
          }
        }
      );

      video = await statusResponse.json();

      console.log(
        "VIRA VIDEO STATUS:",
        video.status,
        video.progress
      );

      if (!statusResponse.ok) {
        return res.status(statusResponse.status).json({
          ok: false,
          error:
            video?.error?.message ||
            "Impossible de récupérer le statut de la vidéo."
        });
      }

      if (video.status === "completed") {
        break;
      }

      if (video.status === "failed") {
        return res.status(500).json({
          ok: false,
          error:
            video?.error?.message ||
            "La génération de la vidéo a échoué."
        });
      }
    }

    if (video.status !== "completed") {
      return res.status(504).json({
        ok: false,
        error: "La génération de la vidéo prend trop de temps."
      });
    }

    console.log("VIRA VIDEO COMPLETED:", video.id);

    // 3. URL interne VIRA pour lire la vidéo
    const videoUrl =
      `/api/video/${encodeURIComponent(video.id)}/content`;

    return res.json({
      ok: true,
      video: {
        id: video.id,
        url: videoUrl,
        status: video.status
      }
    });

  } catch (error) {
    console.error("VIRA VIDEO ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "Erreur interne du serveur."
    });
  }
});


// Proxy sécurisé pour récupérer le fichier vidéo OpenAI
app.get("/api/video/:id/content", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        error: "OPENAI_API_KEY is not configured."
      });
    }

    const videoId = req.params.id;

    const response = await fetch(
      `https://api.openai.com/v1/videos/${encodeURIComponent(videoId)}/content`,
      {
        headers: {
          "Authorization": `Bearer ${API_KEY}`
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "VIRA VIDEO CONTENT ERROR:",
        errorText
      );

      return res.status(response.status).send(errorText);
    }

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Length",
      buffer.length
    );

    res.send(buffer);

  } catch (error) {
    console.error(
      "VIRA VIDEO CONTENT ERROR:",
      error
    );

    res.status(500).json({
      error:
        error?.message ||
        "Impossible de récupérer la vidéo."
    });
  }
});
