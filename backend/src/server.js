import express from 'express';
import cors from 'cors';
import { initDatabase, seedIfEmpty } from './db/init.js';
import tachesRouter from './routes/taches.js';
import refsRouter   from './routes/refs.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Petit logger discret
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/taches', tachesRouter);
app.use('/api/refs',   refsRouter);

// 404 JSON
app.use((req, res) => {
  res.status(404).json({ error: `Route inconnue : ${req.method} ${req.url}` });
});

// Gestion d'erreurs centralisée
app.use((err, _req, res, _next) => {
  console.error('Erreur serveur :', err);
  res.status(500).json({ error: err.message ?? 'Erreur interne' });
});

// Démarrage
(async () => {
  try {
    await initDatabase();
    await seedIfEmpty();
    app.listen(PORT, () => {
      console.log(`\n✓ API de gestion de tâches en écoute sur http://localhost:${PORT}`);
      console.log(`  Routes disponibles :`);
      console.log(`    GET  /api/health`);
      console.log(`    *    /api/taches[/:id[/actions|/contacts]]`);
      console.log(`    *    /api/refs/:table[/:id]\n`);
    });
  } catch (err) {
    console.error('Impossible de démarrer le serveur :', err);
    process.exit(1);
  }
})();
