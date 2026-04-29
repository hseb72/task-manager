import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base SQLite locale via libSQL
const dbPath = path.resolve(__dirname, '../../data/tasks.db');

export const db = createClient({
  url: `file:${dbPath}`,
});

export default db;
