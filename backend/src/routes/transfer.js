import { Router } from 'express';
import { db } from '../db/client.js';
import { gzipSync, gunzipSync } from 'zlib';

const router = Router();

/**
 * Format d'export : un objet JSON contenant l'intégralité des tables
 * de la base, dans un ordre permettant la ré-importation (référentiels d'abord).
 */
const TABLES_IN_ORDER = [
  'entites',
  'services',
  'contacts',
  'etats',
  'domaines',
  'taches',
  'actions',
  'tache_contacts',
];

/* -------------------------------------------------------------------------- */
/*  GET /api/export — télécharge tasks-export.json.gz                          */
/* -------------------------------------------------------------------------- */
router.get('/export', async (_req, res, next) => {
  try {
    const dump = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {},
    };
    for (const table of TABLES_IN_ORDER) {
      const { rows } = await db.execute(`SELECT * FROM ${table}`);
      dump.data[table] = rows;
    }

    const json = JSON.stringify(dump, null, 2);
    const gz   = gzipSync(Buffer.from(json, 'utf8'));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition',
                  `attachment; filename="tasks-export-${stamp}.json.gz"`);
    res.send(gz);
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------------------- */
/*  POST /api/import — restaure depuis tasks-export.json.gz                    */
/*  Body : raw bytes du .gz (Content-Type: application/gzip ou octet-stream)  */
/*  Query: ?mode=replace (par défaut)  ou ?mode=merge                          */
/* -------------------------------------------------------------------------- */
router.post('/import', async (req, res, next) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: 'Corps de requête vide ou invalide (binaire attendu).' });
    }

    let dump;
    try {
      // On accepte aussi un JSON non-gzippé (pour debug)
      const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
      const raw = isGzip ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
      dump = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: 'Fichier invalide : ' + e.message });
    }

    if (!dump || !dump.data || typeof dump.data !== 'object') {
      return res.status(400).json({ error: 'Format inattendu : champ "data" manquant.' });
    }

    const mode = (req.query.mode === 'merge') ? 'merge' : 'replace';

    // Désactivation temporaire des FK pour vider/remplir dans n'importe quel ordre
    await db.execute('PRAGMA foreign_keys = OFF');

    if (mode === 'replace') {
      // On vide dans l'ordre inverse pour respecter les FK théoriques
      for (const table of [...TABLES_IN_ORDER].reverse()) {
        await db.execute(`DELETE FROM ${table}`);
      }
      // Réinitialiser les compteurs AUTOINCREMENT pour repartir de zéro
      try {
        await db.execute(`DELETE FROM sqlite_sequence`);
      } catch {
        /* ignore : la table n'existe peut-être pas encore */
      }
    }

    const counts = {};
    for (const table of TABLES_IN_ORDER) {
      const rows = Array.isArray(dump.data[table]) ? dump.data[table] : [];
      counts[table] = 0;
      if (rows.length === 0) continue;

      // On déduit les colonnes depuis la première ligne
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(', ');
      const verb = mode === 'merge' ? 'INSERT OR REPLACE' : 'INSERT';
      const sql = `${verb} INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        const args = cols.map(c => row[c] === undefined ? null : row[c]);
        try {
          await db.execute({ sql, args });
          counts[table]++;
        } catch (e) {
          // En mode merge, ignorer les conflits ; en replace, signaler
          if (mode === 'replace') throw e;
        }
      }
    }

    await db.execute('PRAGMA foreign_keys = ON');

    res.json({
      ok: true,
      mode,
      version: dump.version ?? null,
      exportedAt: dump.exportedAt ?? null,
      counts,
    });
  } catch (err) {
    try { await db.execute('PRAGMA foreign_keys = ON'); } catch {}
    next(err);
  }
});

export default router;
