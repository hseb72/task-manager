import { Router } from 'express';
import { db } from '../db/client.js';
import { REFERENCE_TABLES } from '../db/init.js';

const router = Router();
const META = new Map(REFERENCE_TABLES.map(r => [r.name, r]));

function getKind(table) {
  return META.get(table)?.kind ?? null;
}

function ensureTable(req, res, next) {
  const { table } = req.params;
  if (!META.has(table)) {
    return res.status(404).json({ error: `Référentiel "${table}" inconnu` });
  }
  next();
}

/* -------------------------------------------------------------------------- */
/*  Sélections enrichies (avec libellés des dépendances)                     */
/* -------------------------------------------------------------------------- */

function selectQuery(table) {
  const kind = getKind(table);
  if (kind === 'service') {
    return `
      SELECT s.*, e.libelle AS entite_libelle
      FROM services s
      LEFT JOIN entites e ON s.entite_id = e.id
      ORDER BY s.libelle COLLATE NOCASE ASC
    `;
  }
  if (kind === 'contact') {
    return `
      SELECT c.*,
             s.libelle AS service_libelle,
             s.entite_id AS entite_id,
             e.libelle AS entite_libelle
      FROM contacts c
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN entites e  ON s.entite_id  = e.id
      ORDER BY c.nom COLLATE NOCASE ASC
    `;
  }
  // simple
  return `SELECT * FROM ${table} ORDER BY libelle COLLATE NOCASE ASC`;
}

function selectByIdQuery(table) {
  const kind = getKind(table);
  if (kind === 'service') {
    return `
      SELECT s.*, e.libelle AS entite_libelle
      FROM services s
      LEFT JOIN entites e ON s.entite_id = e.id
      WHERE s.id = ?
    `;
  }
  if (kind === 'contact') {
    return `
      SELECT c.*,
             s.libelle AS service_libelle,
             s.entite_id AS entite_id,
             e.libelle AS entite_libelle
      FROM contacts c
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN entites e  ON s.entite_id  = e.id
      WHERE c.id = ?
    `;
  }
  return `SELECT * FROM ${table} WHERE id = ?`;
}

/* -------------------------------------------------------------------------- */
/*  GET                                                                       */
/* -------------------------------------------------------------------------- */

router.get('/', (_req, res) => {
  res.json(REFERENCE_TABLES);
});

router.get('/:table', ensureTable, async (req, res, next) => {
  try {
    const { rows } = await db.execute(selectQuery(req.params.table));
    res.json(rows);
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------------------- */
/*  POST                                                                      */
/* -------------------------------------------------------------------------- */

router.post('/:table', ensureTable, async (req, res, next) => {
  try {
    const table = req.params.table;
    const kind = getKind(table);
    const b = req.body ?? {};
    let result;

    if (kind === 'simple') {
      const libelle = (b.libelle ?? '').trim();
      if (!libelle) return res.status(400).json({ error: 'Libellé requis' });
      result = await db.execute({
        sql: `INSERT INTO ${table} (libelle, actif) VALUES (?, ?)`,
        args: [libelle, b.actif === 0 ? 0 : 1],
      });
    } else if (kind === 'service') {
      const libelle = (b.libelle ?? '').trim();
      if (!libelle) return res.status(400).json({ error: 'Libellé requis' });
      result = await db.execute({
        sql: 'INSERT INTO services (libelle, actif, entite_id) VALUES (?, ?, ?)',
        args: [libelle, b.actif === 0 ? 0 : 1, b.entite_id ?? null],
      });
    } else if (kind === 'contact') {
      const nom = (b.nom ?? '').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });
      result = await db.execute({
        sql: `INSERT INTO contacts (nom, role, email, telephone, actif, service_id)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          nom,
          b.role ?? null,
          b.email ?? null,
          b.telephone ?? null,
          b.actif === 0 ? 0 : 1,
          b.service_id ?? null,
        ],
      });
    }

    const { rows } = await db.execute({
      sql: selectByIdQuery(table),
      args: [Number(result.lastInsertRowid)],
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Cette valeur existe déjà' });
    }
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/*  PUT                                                                       */
/* -------------------------------------------------------------------------- */

router.put('/:table/:id', ensureTable, async (req, res, next) => {
  try {
    const table = req.params.table;
    const kind  = getKind(table);
    const id    = Number(req.params.id);
    const b     = req.body ?? {};

    // Map champ JSON -> colonne SQL, par type
    const fieldMaps = {
      simple:  { libelle: 'libelle', actif: 'actif' },
      service: { libelle: 'libelle', actif: 'actif', entite_id: 'entite_id' },
      contact: { nom: 'nom', role: 'role', email: 'email', telephone: 'telephone',
                 actif: 'actif', service_id: 'service_id' },
    };
    const map = fieldMaps[kind];

    const sets = [];
    const args = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in b) {
        let v = b[k];
        if (v === '') v = null;
        if (k === 'actif') v = v ? 1 : 0;
        if (k === 'libelle' || k === 'nom') v = (v ?? '').toString().trim();
        sets.push(`${col} = ?`);
        args.push(v);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    args.push(id);
    await db.execute({
      sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`,
      args,
    });

    const { rows } = await db.execute({ sql: selectByIdQuery(table), args: [id] });
    if (rows.length === 0) return res.status(404).json({ error: 'Valeur introuvable' });
    res.json(rows[0]);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Cette valeur existe déjà' });
    }
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/*  DELETE                                                                    */
/* -------------------------------------------------------------------------- */

router.delete('/:table/:id', ensureTable, async (req, res, next) => {
  try {
    await db.execute({
      sql: `DELETE FROM ${req.params.table} WHERE id = ?`,
      args: [Number(req.params.id)],
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
