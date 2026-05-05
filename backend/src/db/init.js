import { db } from './client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Référentiels disponibles dans l'application.
 *
 *  - "simple"   : id, libelle, actif
 *  - "service"  : id, libelle, actif, entite_id (FK -> entites)
 *  - "contact"  : id, nom, email, telephone, actif, service_id (FK -> services)
 *
 * Le rôle n'est plus un attribut du contact : il est porté par la liaison
 * tache_contacts (un même contact peut tenir des rôles différents selon la tâche).
 */
export const REFERENCE_TABLES = [
  { name: 'entites',   label: 'Entités',                kind: 'simple'  },
  { name: 'services',  label: 'Services',               kind: 'service' },
  { name: 'contacts',  label: 'Contacts',               kind: 'contact' },
  { name: 'roles',     label: 'Rôles',                  kind: 'simple'  },
  { name: 'etats',     label: 'États',                  kind: 'simple'  },
  { name: 'domaines',  label: 'Domaines d\'activité',   kind: 'simple'  },
];

export const SIMPLE_TABLES  = REFERENCE_TABLES.filter(t => t.kind === 'simple').map(t => t.name);
export const ALL_REF_NAMES  = REFERENCE_TABLES.map(t => t.name);

/* -------------------------------------------------------------------------- */
/*  Migrations légères depuis l'ancien schéma                                 */
/*    - colonne 'role' supprimée de contacts (déplacée vers tache_contacts)   */
/*    - colonne 'demandeur_id' renommée en 'intervenant_id' dans taches       */
/*    - ajout 'service_id' dans taches (entité dérivée du service)            */
/*    - suppression de 'entite_id' dans taches si elle existe                 */
/*    - ajout 'role_id' dans tache_contacts                                   */
/* -------------------------------------------------------------------------- */

async function tableExists(name) {
  const { rows } = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [name],
  });
  return rows.length > 0;
}

async function columnExists(table, column) {
  if (!await tableExists(table)) return false;
  const { rows } = await db.execute(`PRAGMA table_info(${table})`);
  return rows.some(r => String(r.name).toLowerCase() === column.toLowerCase());
}

async function runMigrations() {
  // 1. Ajout du référentiel 'roles' (simple) si absent
  await db.execute(`
    CREATE TABLE IF NOT EXISTS roles (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle TEXT NOT NULL UNIQUE,
      actif   INTEGER NOT NULL DEFAULT 1
    )
  `);

  // 2. Migration de la table 'taches' : renommer demandeur_id -> intervenant_id
  //    et ajouter service_id / entite_id si manquants.
  if (await tableExists('taches')) {
    if (!await columnExists('taches', 'intervenant_id')) {
      // SQLite supporte ALTER TABLE RENAME COLUMN depuis 3.25 (libsql ok)
      if (await columnExists('taches', 'demandeur_id')) {
        await db.execute(`ALTER TABLE taches RENAME COLUMN demandeur_id TO intervenant_id`);
        console.log('↻ Migration : taches.demandeur_id → taches.intervenant_id');
      }
    }
    if (!await columnExists('taches', 'service_id')) {
      await db.execute(`ALTER TABLE taches ADD COLUMN service_id INTEGER REFERENCES services(id) ON DELETE SET NULL`);
      console.log('↻ Migration : taches.service_id ajouté');
    }
    // Suppression de taches.entite_id si elle existe (l'entité est désormais dérivée du service)
    if (await columnExists('taches', 'entite_id')) {
      try {
        await db.execute(`ALTER TABLE taches DROP COLUMN entite_id`);
        console.log('↻ Migration : taches.entite_id supprimée (dérivée du service)');
      } catch (err) {
        console.warn('⚠ Impossible de supprimer taches.entite_id automatiquement :', err.message);
        console.warn('  → la colonne sera ignorée par l\'application.');
      }
    }
  }

  // 3. Migration de tache_contacts : ajout de role_id
  if (await tableExists('tache_contacts') && !await columnExists('tache_contacts', 'role_id')) {
    await db.execute(`ALTER TABLE tache_contacts ADD COLUMN role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL`);
    console.log('↻ Migration : tache_contacts.role_id ajouté');
  }

  // 4. Si la colonne 'role' (texte libre) existe encore sur contacts, on tente
  //    de la convertir en valeurs du nouveau référentiel 'roles', puis on la supprime.
  if (await tableExists('contacts') && await columnExists('contacts', 'role')) {
    const { rows: distinctRoles } = await db.execute(
      `SELECT DISTINCT TRIM(role) AS r FROM contacts WHERE role IS NOT NULL AND TRIM(role) <> ''`
    );
    for (const row of distinctRoles) {
      const lib = String(row.r).trim();
      if (!lib) continue;
      try {
        await db.execute({ sql: 'INSERT OR IGNORE INTO roles (libelle) VALUES (?)', args: [lib] });
      } catch { /* ignore */ }
    }
    if (distinctRoles.length > 0) {
      console.log(`↻ Migration : ${distinctRoles.length} valeur(s) de rôle migrées vers le référentiel "roles"`);
    }

    // Suppression de la colonne 'role' (SQLite >= 3.35)
    try {
      await db.execute(`ALTER TABLE contacts DROP COLUMN role`);
      console.log('↻ Migration : contacts.role supprimée');
    } catch (err) {
      console.warn('⚠ Impossible de supprimer contacts.role automatiquement :', err.message);
      console.warn('  → la colonne sera ignorée par l\'application.');
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Création initiale                                                         */
/* -------------------------------------------------------------------------- */

export async function initDatabase() {
  await db.execute('PRAGMA foreign_keys = ON');

  // ----- Référentiels simples (entites, etats, domaines, roles) -----
  for (const name of SIMPLE_TABLES) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ${name} (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle TEXT NOT NULL UNIQUE,
        actif   INTEGER NOT NULL DEFAULT 1
      )
    `);
  }

  // ----- Services -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle   TEXT NOT NULL,
      actif     INTEGER NOT NULL DEFAULT 1,
      entite_id INTEGER REFERENCES entites(id) ON DELETE SET NULL,
      UNIQUE (libelle, entite_id)
    )
  `);

  // ----- Contacts (sans 'role') -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nom        TEXT NOT NULL,
      email      TEXT,
      telephone  TEXT,
      actif      INTEGER NOT NULL DEFAULT 1,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL
    )
  `);

  // ----- Tâches : intervenant + service + entité directs -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS taches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle             TEXT NOT NULL,
      description         TEXT,
      date_declaration    TEXT,
      date_echeance       TEXT,
      date_fin            TEXT,
      duree_prevue        REAL,
      duree_accomplie     REAL,
      intervenant_id      INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      service_id          INTEGER REFERENCES services(id) ON DELETE SET NULL,
      etat_id             INTEGER REFERENCES etats(id)    ON DELETE SET NULL,
      domaine_id          INTEGER REFERENCES domaines(id) ON DELETE SET NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ----- Actions menées (1..N par tâche) -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS actions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tache_id    INTEGER NOT NULL REFERENCES taches(id) ON DELETE CASCADE,
      date_action TEXT,
      libelle     TEXT NOT NULL,
      description TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ----- Liaison tâche-contact, désormais portée par un rôle optionnel -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tache_contacts (
      tache_id   INTEGER NOT NULL REFERENCES taches(id)   ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      role_id    INTEGER REFERENCES roles(id) ON DELETE SET NULL,
      PRIMARY KEY (tache_id, contact_id)
    )
  `);

  // Index utiles
  await db.execute('CREATE INDEX IF NOT EXISTS idx_actions_tache       ON actions(tache_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_taches_etat         ON taches(etat_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_services_entite     ON services(entite_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_contacts_service    ON contacts(service_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tache_contacts_t    ON tache_contacts(tache_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_tache_contacts_c    ON tache_contacts(contact_id)');

  // Migrations sur les bases pré-existantes
  await runMigrations();

  console.log('✓ Schéma de base de données initialisé');
}

/* -------------------------------------------------------------------------- */
/*  Données de démonstration                                                  */
/* -------------------------------------------------------------------------- */

export async function seedIfEmpty() {
  const simpleSeeds = {
    entites:  ['Direction Générale', 'Filiale Nord', 'Filiale Sud'],
    etats:    ['À faire', 'En cours', 'En attente', 'Terminée', 'Annulée'],
    domaines: ['Développement', 'Support', 'Infrastructure', 'Administratif'],
    roles:    ['Responsable', 'Suiveur', 'Validateur', 'Informateur', 'Demandeur'],
  };

  for (const [table, values] of Object.entries(simpleSeeds)) {
    const { rows } = await db.execute(`SELECT COUNT(*) as c FROM ${table}`);
    if (Number(rows[0].c) === 0) {
      for (const libelle of values) {
        await db.execute({
          sql: `INSERT INTO ${table} (libelle) VALUES (?)`,
          args: [libelle],
        });
      }
      console.log(`✓ Référentiel "${table}" rempli`);
    }
  }

  // Services
  const { rows: servCount } = await db.execute('SELECT COUNT(*) as c FROM services');
  if (Number(servCount[0].c) === 0) {
    const ents = await db.execute('SELECT id, libelle FROM entites');
    const findEntite = (lib) => ents.rows.find(r => r.libelle === lib)?.id ?? null;

    const services = [
      { libelle: 'Comptabilité',         entite: 'Direction Générale' },
      { libelle: 'Informatique',         entite: 'Direction Générale' },
      { libelle: 'Ressources Humaines',  entite: 'Direction Générale' },
      { libelle: 'Production',           entite: 'Filiale Nord' },
      { libelle: 'Logistique',           entite: 'Filiale Sud' },
    ];
    for (const s of services) {
      await db.execute({
        sql: 'INSERT INTO services (libelle, entite_id) VALUES (?, ?)',
        args: [s.libelle, findEntite(s.entite)],
      });
    }
    console.log('✓ Référentiel "services" rempli');
  }

  // Contacts (sans rôle)
  const { rows: cContact } = await db.execute('SELECT COUNT(*) as c FROM contacts');
  if (Number(cContact[0].c) === 0) {
    const servs = await db.execute('SELECT id, libelle FROM services');
    const findService = (lib) => servs.rows.find(r => r.libelle === lib)?.id ?? null;

    const contacts = [
      { nom: 'Alice Martin',     email: 'alice.martin@example.com',    telephone: '01 02 03 04 05', service: 'Comptabilité' },
      { nom: 'Bruno Dupont',     email: 'bruno.dupont@example.com',    telephone: '01 02 03 04 06', service: 'Informatique' },
      { nom: 'Claire Lefebvre',  email: 'claire.lefebvre@example.com', telephone: '01 02 03 04 07', service: 'Ressources Humaines' },
      { nom: 'David Rousseau',   email: 'david.rousseau@example.com',  telephone: '03 02 03 04 08', service: 'Production' },
    ];
    for (const c of contacts) {
      await db.execute({
        sql: `INSERT INTO contacts (nom, email, telephone, service_id) VALUES (?, ?, ?, ?)`,
        args: [c.nom, c.email, c.telephone, findService(c.service)],
      });
    }
    console.log('✓ Référentiel "contacts" rempli');
  }

  // Tâche d'exemple
  const { rows } = await db.execute('SELECT COUNT(*) as c FROM taches');
  if (Number(rows[0].c) === 0) {
    await db.execute({
      sql: `INSERT INTO taches
            (libelle, description, date_declaration, date_echeance,
             duree_prevue, duree_accomplie,
             intervenant_id, service_id, etat_id, domaine_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'Mise en place de l\'outil de gestion',
        'Tâche de démonstration illustrant les capacités du système.',
        '2026-04-01',
        '2026-05-15',
        20,
        5,
        1,           // intervenant : Alice
        2,           // service Informatique (l'entité DG est dérivée)
        2,           // état En cours
        1,           // domaine Développement
      ],
    });
    // Lier Bruno comme suiveur
    await db.execute({
      sql: 'INSERT INTO tache_contacts (tache_id, contact_id, role_id) VALUES (?, ?, ?)',
      args: [1, 2, 2],
    });
    console.log('✓ Tâche d\'exemple insérée');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initDatabase();
  await seedIfEmpty();
  console.log('Base de données prête.');
  process.exit(0);
}
