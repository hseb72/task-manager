import { Router } from 'express';
import { db } from '../db/client.js';

const router = Router();

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function rowToTache(row) {
  if (!row) return null;
  return {
    id:                 row.id,
    libelle:            row.libelle,
    description:        row.description,
    dateDeclaration:    row.date_declaration,
    dateEcheance:       row.date_echeance,
    dateFin:            row.date_fin,
    dureePrevue:        row.duree_prevue,
    dureeAccomplie:     row.duree_accomplie,
    demandeurId:        row.demandeur_id,
    etatId:             row.etat_id,
    domaineId:          row.domaine_id,

    // Libellés joints (lecture seule)
    demandeurNom:       row.demandeur_nom        ?? null,
    demandeurServiceId: row.demandeur_service_id ?? null,
    demandeurService:   row.demandeur_service    ?? null,
    demandeurEntiteId:  row.demandeur_entite_id  ?? null,
    demandeurEntite:    row.demandeur_entite     ?? null,
    etatLibelle:        row.etat_libelle         ?? null,
    domaineLibelle:     row.domaine_libelle      ?? null,

    createdAt:          row.created_at,
    updatedAt:          row.updated_at,
  };
}

const SELECT_TACHE_JOIN = `
  SELECT t.*,
         dc.nom        AS demandeur_nom,
         dc.service_id AS demandeur_service_id,
         ds.libelle    AS demandeur_service,
         ds.entite_id  AS demandeur_entite_id,
         de.libelle    AS demandeur_entite,
         et.libelle    AS etat_libelle,
         dm.libelle    AS domaine_libelle
  FROM taches t
  LEFT JOIN contacts dc ON t.demandeur_id = dc.id
  LEFT JOIN services ds ON dc.service_id  = ds.id
  LEFT JOIN entites  de ON ds.entite_id   = de.id
  LEFT JOIN etats    et ON t.etat_id      = et.id
  LEFT JOIN domaines dm ON t.domaine_id   = dm.id
`;

/** Charge les contacts associés (via tache_contacts) avec leurs joints. */
async function loadTacheContacts(tacheId) {
  const { rows } = await db.execute({
    sql: `
      SELECT c.*,
             s.libelle    AS service_libelle,
             s.entite_id  AS entite_id,
             e.libelle    AS entite_libelle
      FROM tache_contacts tc
      JOIN contacts c ON tc.contact_id = c.id
      LEFT JOIN services s ON c.service_id = s.id
      LEFT JOIN entites  e ON s.entite_id  = e.id
      WHERE tc.tache_id = ?
      ORDER BY c.nom COLLATE NOCASE ASC
    `,
    args: [tacheId],
  });
  return rows;
}

/* -------------------------------------------------------------------------- */
/*  TACHES CRUD                                                               */
/* -------------------------------------------------------------------------- */

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await db.execute(`${SELECT_TACHE_JOIN} ORDER BY t.id DESC`);
    res.json(rows.map(rowToTache));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await db.execute({
      sql: `${SELECT_TACHE_JOIN} WHERE t.id = ?`,
      args: [id],
    });
    if (rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });

    const tache = rowToTache(rows[0]);

    const actions = await db.execute({
      sql: 'SELECT * FROM actions WHERE tache_id = ? ORDER BY date_action DESC, id DESC',
      args: [id],
    });
    tache.actions  = actions.rows;
    tache.contacts = await loadTacheContacts(id);

    res.json(tache);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const result = await db.execute({
      sql: `INSERT INTO taches
            (libelle, description, date_declaration, date_echeance, date_fin,
             duree_prevue, duree_accomplie,
             demandeur_id, etat_id, domaine_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        b.libelle ?? '(sans libellé)',
        b.description     ?? null,
        b.dateDeclaration ?? null,
        b.dateEcheance    ?? null,
        b.dateFin         ?? null,
        b.dureePrevue     ?? null,
        b.dureeAccomplie  ?? null,
        b.demandeurId     ?? null,
        b.etatId          ?? null,
        b.domaineId       ?? null,
      ],
    });
    const id = Number(result.lastInsertRowid);
    const { rows } = await db.execute({
      sql: `${SELECT_TACHE_JOIN} WHERE t.id = ?`,
      args: [id],
    });
    res.status(201).json(rowToTache(rows[0]));
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body ?? {};

    const fieldMap = {
      libelle:          'libelle',
      description:      'description',
      dateDeclaration:  'date_declaration',
      dateEcheance:     'date_echeance',
      dateFin:          'date_fin',
      dureePrevue:      'duree_prevue',
      dureeAccomplie:   'duree_accomplie',
      demandeurId:      'demandeur_id',
      etatId:           'etat_id',
      domaineId:        'domaine_id',
    };

    const sets = [];
    const args = [];
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in b) {
        sets.push(`${col} = ?`);
        args.push(b[key] === '' ? null : b[key]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    sets.push(`updated_at = datetime('now')`);
    args.push(id);

    await db.execute({
      sql: `UPDATE taches SET ${sets.join(', ')} WHERE id = ?`,
      args,
    });

    const { rows } = await db.execute({
      sql: `${SELECT_TACHE_JOIN} WHERE t.id = ?`,
      args: [id],
    });
    if (rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json(rowToTache(rows[0]));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.execute({ sql: 'DELETE FROM taches WHERE id = ?', args: [id] });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------------------- */
/*  ACTIONS                                                                   */
/* -------------------------------------------------------------------------- */

router.get('/:id/actions', async (req, res, next) => {
  try {
    const { rows } = await db.execute({
      sql: 'SELECT * FROM actions WHERE tache_id = ? ORDER BY date_action DESC, id DESC',
      args: [Number(req.params.id)],
    });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/:id/actions', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const result = await db.execute({
      sql: `INSERT INTO actions (tache_id, date_action, libelle, description)
            VALUES (?, ?, ?, ?)`,
      args: [id, b.dateAction ?? null, b.libelle ?? '', b.description ?? null],
    });
    const { rows } = await db.execute({
      sql: 'SELECT * FROM actions WHERE id = ?',
      args: [Number(result.lastInsertRowid)],
    });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id/actions/:actionId', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    await db.execute({
      sql: `UPDATE actions
            SET date_action = ?, libelle = ?, description = ?
            WHERE id = ? AND tache_id = ?`,
      args: [
        b.dateAction ?? null,
        b.libelle ?? '',
        b.description ?? null,
        Number(req.params.actionId),
        Number(req.params.id),
      ],
    });
    const { rows } = await db.execute({
      sql: 'SELECT * FROM actions WHERE id = ?',
      args: [Number(req.params.actionId)],
    });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id/actions/:actionId', async (req, res, next) => {
  try {
    await db.execute({
      sql: 'DELETE FROM actions WHERE id = ? AND tache_id = ?',
      args: [Number(req.params.actionId), Number(req.params.id)],
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* -------------------------------------------------------------------------- */
/*  CONTACTS associés à une tâche (relation N:N)                              */
/*    Le contact lui-même est géré dans /api/refs/contacts                    */
/* -------------------------------------------------------------------------- */

router.get('/:id/contacts', async (req, res, next) => {
  try {
    const list = await loadTacheContacts(Number(req.params.id));
    res.json(list);
  } catch (err) { next(err); }
});

// Lier un contact existant à une tâche
router.post('/:id/contacts', async (req, res, next) => {
  try {
    const tacheId   = Number(req.params.id);
    const contactId = Number(req.body?.contactId);
    if (!contactId) {
      return res.status(400).json({ error: 'contactId requis' });
    }

    await db.execute({
      sql: `INSERT OR IGNORE INTO tache_contacts (tache_id, contact_id) VALUES (?, ?)`,
      args: [tacheId, contactId],
    });

    const list = await loadTacheContacts(tacheId);
    res.status(201).json(list);
  } catch (err) { next(err); }
});

// Détacher un contact d'une tâche (le contact n'est PAS supprimé du référentiel)
router.delete('/:id/contacts/:contactId', async (req, res, next) => {
  try {
    await db.execute({
      sql: 'DELETE FROM tache_contacts WHERE tache_id = ? AND contact_id = ?',
      args: [Number(req.params.id), Number(req.params.contactId)],
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
