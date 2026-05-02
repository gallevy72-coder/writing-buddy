import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import chatRoutes from './routes/chat.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    groq: !!process.env.GROQ_API_KEY,
    hf: !!process.env.HF_API_KEY,
    node: process.version,
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/chat', chatRoutes);

// Serve static files in production
app.use(express.static(join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(join(__dirname, '../client/dist/index.html'));
  }
});

const hfKey = process.env.HF_API_KEY;
const hfMask = hfKey ? `${hfKey.slice(0, 4)}…${hfKey.slice(-4)} (len=${hfKey.length})` : 'MISSING';
const hfRelated = Object.keys(process.env).filter(k => /hf|hugging/i.test(k));
console.log(`[startup] HF_API_KEY: ${hfMask}`);
console.log(`[startup] HF-related env keys found: ${hfRelated.join(', ') || '(none)'}`);
console.log(`[startup] GROQ_API_KEY: ${process.env.GROQ_API_KEY ? 'set' : 'MISSING'}`);
console.log(`[startup] OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'set' : 'MISSING'}`);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
