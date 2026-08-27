import "dotenv/config";
import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
const app = express();
const port = Number(process.env.PORT || 10000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const API_KEY = process.env.OPENAI_API_KEY;
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

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error:
          data?.error?.message ||
          "Erreur lors de la création de la vidéo."
      });
    }

    if (!data?.id) {
      return res.status(502).json({
        ok: false,
        error: "Aucun identifiant vidéo reçu."
      });
    }

    return res.json({
      ok: true,
      id: data.id,
      status: data.status || "queued"
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

    console.log("VIRA VOICE REQUEST:", text.trim());

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
          input: text.trim(),
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
app.listen(port, () => {
  console.log(`VIRA backend running on port ${port}`);
});
