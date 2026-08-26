import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));
const API_KEY = process.env.OPENAI_API_KEY;

// ===============================
// HEALTH CHECK
// ===============================

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'VIRA backend',
    version: '0.2.0',
    openai: Boolean(API_KEY)
  });
});

// ===============================
// GENERATE SCENARIO
// ===============================

async function generateScenario(req, res) {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: 'OPENAI_API_KEY is not configured on Render.'
      });
    }

    const {
      prompt,
      duration = 30,
      format = 'short'
    } = req.body || {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'A video idea is required.'
      });
    }

    const instruction = `
Tu es VIRA, une IA professionnelle de création vidéo.

Crée un scénario prêt à produire à partir de cette idée :

"${prompt.trim()}"

Format : ${format}
Durée : ${duration} secondes.

Le scénario doit être captivant, visuel et adapté aux réseaux sociaux.

Structure obligatoire :

TITRE:
HOOK:
SCÈNE 1:
SCÈNE 2:
SCÈNE 3:
SCÈNE 4:
SCÈNE 5:
VOIX OFF:
FIN:

Réponse en français.
`;

    const response = await fetch(
      'https://api.openai.com/v1/responses',
      {
       headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input: instruction
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI error:', data);

      return res.status(response.status).json({
        ok: false,
        error: data?.error?.message || 'OpenAI request failed.'
      });
    }

    const text = data?.output_text;

    if (!text) {
      return res.status(502).json({
        ok: false,
        error: 'No scenario was returned by OpenAI.'
      });
    }

    return res.json({
      ok: true,
      scenario: text,
      script: text,
      text
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error?.message || 'Scenario generation failed.'
    });
  }
}

// Routes scénario
app.post('/api/scenario/generate', generateScenario);
app.post('/api/scenario', generateScenario);
app.post('/api/script/generate', generateScenario);

// ===============================
// GENERATE IMAGE
// ===============================

app.post('/api/images/generate', async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({
        ok: false,
        error: 'OPENAI_API_KEY is not configured on Render.'
      });
    }

    const {
      prompt,
      size = '1024x1536',
      quality = 'medium'
    } = req.body || {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'A valid image prompt is required.'
      });
    }

    const response = await fetch(
      'https://api.openai.com/v1/images/generations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
'Authorization': `Bearer ${API_KEY}`
},
body: JSON.stringify({
  model: 'gpt-image-2',
  prompt: prompt.trim(),
  size,
  quality,
  n: 1
})  }
);

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI image error:', data);

      return res.status(response.status).json({
        ok: false,
        error: data?.error?.message || 'Image generation failed.'
      });
    }

    const image = data?.data?.[0]?.b64_json;

    if (!image) {
      return res.status(502).json({
        ok: false,
        error: 'No image was returned by OpenAI.'
      });
    }

    return res.json({
      ok: true,
      image: `data:image/png;base64,${image}`
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error?.message || 'Image generation failed.'
    });
  }
});

// ===============================
// START SERVER
// ===============================

app.listen(port, () => {
  console.log(`VIRA backend running on port ${port}`);
});      
