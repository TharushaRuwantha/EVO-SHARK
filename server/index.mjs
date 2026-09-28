import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CHECKPOINT_PATH = path.join(DATA_DIR, 'checkpoint.json');
const CHECKPOINT_TMP_PATH = path.join(DATA_DIR, 'checkpoint.json.tmp');
const PORT = process.env.RL_SERVER_PORT ? Number(process.env.RL_SERVER_PORT) : 5175;

const app = express();
app.use(express.json({ limit: '25mb' }));

app.get('/api/checkpoint', async (_req, res) => {
  try {
    const raw = await fs.readFile(CHECKPOINT_PATH, 'utf-8');
    res.type('application/json').send(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.status(404).json({ error: 'no checkpoint saved yet' });
    } else {
      console.error('Failed to read checkpoint:', err);
      res.status(500).json({ error: 'failed to read checkpoint' });
    }
  }
});

app.post('/api/checkpoint', async (req, res) => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Write to a temp file then rename, so a crash mid-write never corrupts
    // the last-good checkpoint (important since this is called from
    // pagehide/sendBeacon during abrupt shutdowns).
    await fs.writeFile(CHECKPOINT_TMP_PATH, JSON.stringify(req.body));
    await fs.rename(CHECKPOINT_TMP_PATH, CHECKPOINT_PATH);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Failed to save checkpoint:', err);
    res.status(500).json({ error: 'failed to save checkpoint' });
  }
});

app.listen(PORT, () => {
  console.log(`[rl-server] checkpoint save-server listening on http://localhost:${PORT}`);
  console.log(`[rl-server] checkpoints stored at ${CHECKPOINT_PATH}`);
});
