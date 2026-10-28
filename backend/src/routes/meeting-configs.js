import { Router } from 'express';
import { db } from '../db/client.js';

const router = Router();

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/* Liste tous les paramétrages enregistrés. */
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await db.execute(
      `SELECT name, payload, updated_at FROM meeting_configs ORDER BY name COLLATE NOCASE ASC`
    );
    res.json(rows.map(r => ({ name: r.name, config: safeParse(r.payload), updatedAt: r.updated_at })));
  } catch (e) { next(e); }
});

/* Crée ou met à jour (upsert par nom) un paramétrage. */
router.put('/:name', async (req, res, next) => {
  try {
    const name = String(req.params.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Nom de paramétrage requis' });
    const payload = JSON.stringify(req.body ?? {});
    await db.execute({
      sql: `INSERT INTO meeting_configs (name, payload, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(name) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`,
      args: [name, payload],
    });
    res.json({ name, config: req.body ?? {} });
  } catch (e) { next(e); }
});

/* Supprime un paramétrage. */
router.delete('/:name', async (req, res, next) => {
  try {
    const name = String(req.params.name ?? '').trim();
    await db.execute({ sql: `DELETE FROM meeting_configs WHERE name = ?`, args: [name] });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
