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

    console.log("VIRA IMAGE RECEIVED: YES");

    return res.json({
      ok: true,
      image: `data:image/png;base64,${image}`
    });

  } catch (error) {
    console.error(
      "VIRA SERVER ERROR:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Internal server error."
    });
  }
});

app.listen(port, () => {
  console.log(
    `VIRA backend running on port ${port}`
  );
});
