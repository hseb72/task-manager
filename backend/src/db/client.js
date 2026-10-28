import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base SQLite locale via libSQL
const dataDir = path.resolve(__dirname, '../../data');
const dbPath = path.join(dataDir, 'tasks.db');

// On s'assure que le dossier existe AVANT d'ouvrir la base : libSQL ouvre le
// fichier immédiatement et échouerait (SQLITE_CANTOPEN) si le dossier manquait.
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = createClient({
  url: `file:${dbPath}`,
});

export default db;
