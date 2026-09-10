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
/*  Liste paginée / triée / recherchée (côté serveur)                          */
/* -------------------------------------------------------------------------- */

/**
 * Configuration par type : clause FROM/JOIN, colonnes projetées, colonnes de
 * recherche (LIKE), correspondance clé de tri → expression SQL (liste blanche),
 * tri par défaut et clé primaire (tri secondaire stable).
 */
function listConfig(table) {
  const kind = getKind(table);
  if (kind === 'service') {
    return {
      from: 'FROM services s LEFT JOIN entites e ON s.entite_id = e.id',
      cols: 's.*, e.libelle AS entite_libelle',
      searchCols: ['s.libelle', 'e.libelle'],
      sortMap: {
        id: 's.id', libelle: 's.libelle COLLATE NOCASE',
        entite_libelle: 'e.libelle COLLATE NOCASE', actif: 's.actif',
      },
      filterMap: {
        libelle:   { col: 's.libelle', type: 'text' },
        entite_id: { col: 's.entite_id', type: 'eq' },
        actif:     { col: 's.actif', type: 'eq' },
      },
      defaultSort: 's.libelle COLLATE NOCASE', pk: 's.id',
    };
  }
  if (kind === 'contact') {
    return {
      from: `FROM contacts c
             LEFT JOIN services s ON c.service_id = s.id
             LEFT JOIN entites e  ON s.entite_id  = e.id`,
      cols: `c.*, s.libelle AS service_libelle, s.entite_id AS entite_id, e.libelle AS entite_libelle`,
      searchCols: ['c.nom', 'c.email', 'c.telephone', 'c.fonction', 's.libelle', 'e.libelle'],
      sortMap: {
        id: 'c.id', nom: 'c.nom COLLATE NOCASE',
        service_libelle: 's.libelle COLLATE NOCASE', entite_libelle: 'e.libelle COLLATE NOCASE',
        fonction: 'c.fonction COLLATE NOCASE', email: 'c.email COLLATE NOCASE',
        telephone: 'c.telephone COLLATE NOCASE', actif: 'c.actif',
      },
      filterMap: {
        nom:        { col: 'c.nom', type: 'text' },
        service_id: { col: 'c.service_id', type: 'eq' },
        entite_id:  { col: 's.entite_id', type: 'eq' },
        fonction:   { col: 'c.fonction', type: 'text' },
        email:      { col: 'c.email', type: 'text' },
        telephone:  { col: 'c.telephone', type: 'text' },
        actif:      { col: 'c.actif', type: 'eq' },
      },
      defaultSort: 'c.nom COLLATE NOCASE', pk: 'c.id',
    };
  }
  // simple
  return {
    from: `FROM ${table}`,
    cols: '*',
    searchCols: ['libelle'],
    sortMap: { id: 'id', libelle: 'libelle COLLATE NOCASE', actif: 'actif' },
    filterMap: {
      libelle: { col: 'libelle', type: 'text' },
      actif:   { col: 'actif', type: 'eq' },
    },
    defaultSort: 'libelle COLLATE NOCASE', pk: 'id',
  };
}

/* -------------------------------------------------------------------------- */
/*  GET                                                                       */
/* -------------------------------------------------------------------------- */

router.get('/', (_req, res) => {
  res.json(REFERENCE_TABLES);
});

router.get('/:table', ensureTable, async (req, res, next) => {
  try {
    const table = req.params.table;
    const q = req.query ?? {};

    // Sans paramètre de pagination/tri/recherche : liste complète (rétro-compat,
    // utilisée par les listes déroulantes et l'export).
    const wantsPaged = q.page !== undefined || q.pageSize !== undefined ||
                       q.sort !== undefined || q.q !== undefined;
    if (!wantsPaged) {
      const { rows } = await db.execute(selectQuery(table));
      return res.json(rows);
    }

    const cfg = listConfig(table);

    // WHERE = recherche globale (q) + filtres par colonne (f_<clé>), combinés en AND.
    const clauses = [];
    const whereArgs = [];

    const term = String(q.q ?? '').trim();
    if (term) {
      clauses.push('(' + cfg.searchCols.map(c => `${c} LIKE ?`).join(' OR ') + ')');
      for (const _ of cfg.searchCols) whereArgs.push('%' + term + '%');
    }

    for (const [key, def] of Object.entries(cfg.filterMap)) {
      const raw = q['f_' + key];
      if (raw === undefined || raw === '') continue;
      if (def.type === 'text') {
        clauses.push(`${def.col} LIKE ?`);
        whereArgs.push('%' + String(raw) + '%');
      } else { // eq
        clauses.push(`${def.col} = ?`);
        const n = Number(raw);
        whereArgs.push(Number.isFinite(n) && String(n) === String(raw) ? n : String(raw));
      }
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

    // Tri (liste blanche) + direction
    const sortExpr = cfg.sortMap[String(q.sort ?? '')] ?? cfg.defaultSort;
    const dir = String(q.dir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const orderBy = `ORDER BY ${sortExpr} ${dir}, ${cfg.pk} ASC`;

    // Pagination (bornée)
    let pageSize = parseInt(String(q.pageSize ?? '25'), 10);
    if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 25;
    pageSize = Math.min(pageSize, 500);
    let page = parseInt(String(q.page ?? '1'), 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const countSql = `SELECT COUNT(*) AS n ${cfg.from} ${where}`;
    const { rows: cnt } = await db.execute({ sql: countSql, args: whereArgs });
    const total = Number(cnt[0]?.n ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (page > pageCount) page = pageCount;
    const offset = (page - 1) * pageSize;

    const rowsSql = `SELECT ${cfg.cols} ${cfg.from} ${where} ${orderBy} LIMIT ? OFFSET ?`;
    const { rows } = await db.execute({ sql: rowsSql, args: [...whereArgs, pageSize, offset] });

    res.json({ rows, total, page, pageSize, pageCount });
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
      const nom = (b.nom ?? '').replace(/\s+/g, ' ').trim();
      if (!nom) return res.status(400).json({ error: 'Nom requis' });
      // Interdiction des doublons : un contact du même nom (à la casse et aux
      // espaces près) ne peut pas être créé deux fois.
      const key = nom.toLowerCase();
      const { rows: existing } = await db.execute('SELECT id, nom FROM contacts');
      const dup = existing.find(r => String(r.nom).replace(/\s+/g, ' ').trim().toLowerCase() === key);
      if (dup) {
        return res.status(409).json({
          error: `Un contact nommé « ${nom} » existe déjà`,
          existingId: Number(dup.id),
        });
      }
      result = await db.execute({
        sql: `INSERT INTO contacts (nom, email, telephone, actif, service_id, fonction)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          nom,
          b.email ?? null,
          b.telephone ?? null,
          b.actif === 0 ? 0 : 1,
          b.service_id ?? null,
          b.fonction ?? null,
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
      contact: { nom: 'nom', email: 'email', telephone: 'telephone',
                 actif: 'actif', service_id: 'service_id', fonction: 'fonction' },
    };
    const map = fieldMaps[kind];

    const sets = [];
    const args = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in b) {
        // Le secret n'est mis à jour que si une nouvelle valeur non vide est
        // fournie ; une chaîne vide signifie « inchangé » (jamais renvoyé en clair).
        if (k === 'auth_secret' && !b[k]) continue;
        let v = b[k];
        if (v === '') v = null;
        if (k === 'actif' || k === 'rendu_js') v = v ? 1 : 0;
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
