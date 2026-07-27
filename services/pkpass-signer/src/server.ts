import express from 'express';
import { buildPass, type CardData } from './buildPass.js';

const app = express();
app.use(express.json());

// Internal-only service: never exposed publicly. Only the Supabase Edge Functions
// (enroll, apple-passkit-get-pass) call this, over a private URL, with this header.
app.use((req, res, next) => {
  const secret = req.header('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.post('/generate-pass', async (req, res) => {
  try {
    const data = req.body as CardData;
    const buffer = await buildPass(data);
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.send(buffer);
  } catch (err) {
    console.error('generate-pass failed', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`pkpass-signer listening on :${port}`));
