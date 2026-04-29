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
 *  - "contact"  : id, nom, role, email, telephone, actif, service_id (FK -> services)
 *
 * L'ordre détermine l'affichage de la sidebar côté frontend.
 */
export const REFERENCE_TABLES = [
  { name: 'entites',   label: 'Entités',                kind: 'simple'  },
  { name: 'services',  label: 'Services',               kind: 'service' },
  { name: 'contacts',  label: 'Contacts',               kind: 'contact' },
  { name: 'etats',     label: 'États',                  kind: 'simple'  },
  { name: 'domaines',  label: 'Domaines d\'activité',   kind: 'simple'  },
];

export const SIMPLE_TABLES  = REFERENCE_TABLES.filter(t => t.kind === 'simple').map(t => t.name);
export const ALL_REF_NAMES  = REFERENCE_TABLES.map(t => t.name);

export async function initDatabase() {
  await db.execute('PRAGMA foreign_keys = ON');

  // ----- Référentiels simples (entites, etats, domaines) -----
  for (const name of SIMPLE_TABLES) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ${name} (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        libelle TEXT NOT NULL UNIQUE,
        actif   INTEGER NOT NULL DEFAULT 1
      )
    `);
  }

  // ----- Services (rattachés à une entité) -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS services (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle   TEXT NOT NULL,
      actif     INTEGER NOT NULL DEFAULT 1,
      entite_id INTEGER REFERENCES entites(id) ON DELETE SET NULL,
      UNIQUE (libelle, entite_id)
    )
  `);

  // ----- Contacts (rattachés à un service) -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nom        TEXT NOT NULL,
      role       TEXT,
      email      TEXT,
      telephone  TEXT,
      actif      INTEGER NOT NULL DEFAULT 1,
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL
    )
  `);

  // ----- Tâches : le demandeur est un contact -----
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
      demandeur_id        INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      etat_id             INTEGER REFERENCES etats(id)    ON DELETE SET NULL,
      domaine_id          INTEGER REFERENCES domaines(id) ON DELETE SET NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ----- Actions menées (1..N par tâche, inchangé) -----
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

  // ----- Liaison N:N entre tâches et contacts -----
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tache_contacts (
      tache_id   INTEGER NOT NULL REFERENCES taches(id)   ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
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

  console.log('✓ Schéma de base de données initialisé');
}

/**
 * Insertion de quelques valeurs de référence + une tâche d'exemple,
 * uniquement si les tables sont vides.
 */
export async function seedIfEmpty() {
  // Référentiels simples
  const simpleSeeds = {
    entites:  ['Direction Générale', 'Filiale Nord', 'Filiale Sud'],
    etats:    ['À faire', 'En cours', 'En attente', 'Terminée', 'Annulée'],
    domaines: ['Développement', 'Support', 'Infrastructure', 'Administratif'],
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

  // Services (avec rattachement à une entité)
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

  // Contacts (avec rattachement à un service)
  const { rows: cContact } = await db.execute('SELECT COUNT(*) as c FROM contacts');
  if (Number(cContact[0].c) === 0) {
    const servs = await db.execute('SELECT id, libelle FROM services');
    const findService = (lib) => servs.rows.find(r => r.libelle === lib)?.id ?? null;

    const contacts = [
      { nom: 'Alice Martin',     role: 'Responsable',    email: 'alice.martin@example.com',    telephone: '01 02 03 04 05', service: 'Comptabilité' },
      { nom: 'Bruno Dupont',     role: 'Chef de projet', email: 'bruno.dupont@example.com',    telephone: '01 02 03 04 06', service: 'Informatique' },
      { nom: 'Claire Lefebvre',  role: 'Gestionnaire',   email: 'claire.lefebvre@example.com', telephone: '01 02 03 04 07', service: 'Ressources Humaines' },
      { nom: 'David Rousseau',   role: 'Technicien',     email: 'david.rousseau@example.com',  telephone: '03 02 03 04 08', service: 'Production' },
    ];
    for (const c of contacts) {
      await db.execute({
        sql: `INSERT INTO contacts (nom, role, email, telephone, service_id)
              VALUES (?, ?, ?, ?, ?)`,
        args: [c.nom, c.role, c.email, c.telephone, findService(c.service)],
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
             demandeur_id, etat_id, domaine_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'Mise en place de l\'outil de gestion',
        'Tâche de démonstration illustrant les capacités du système.',
        '2026-04-01',
        '2026-05-15',
        20,
        5,
        1, 2, 1,
      ],
    });
    // Liaison à un contact secondaire
    await db.execute({
      sql: 'INSERT INTO tache_contacts (tache_id, contact_id) VALUES (?, ?)',
      args: [1, 2],
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
