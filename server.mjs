import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
const port = Number(process.env.PORT || 3000);

if (!process.env.OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY is missing. Image generation will return a clear setup error.');
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'VIRA backend', version: '0.1.0' });
});

app.post('/api/images/generate', async (req, res) => {
  try {
    const { prompt, size = '1024x1536', quality = 'medium' } = req.body || {};

    if (typeof prompt !== 'string' || prompt.trim().length < 3) {
      return res.status(400).json({ error: 'A valid prompt is required.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: 'OPENAI_API_KEY is not configured on the server.'
      });
    }

    const response = await client.images.generate({
      model: 'gpt-image-1',
      prompt: prompt.trim(),
      size,
      quality
    });

    const image = response?.data?.[0]?.b64_json;
    if (!image) {
      return res.status(502).json({ error: 'The image provider returned no image.' });
    }

    res.json({
      ok: true,
      image: `data:image/png;base64,${image}`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error?.message || 'Image generation failed.'
    });
  }
});

app.listen(port, () => {
  console.log(`VIRA backend running at http://localhost:${port}`);
});
