/**
 * Initialize the local SQLite database with schema.
 * Run: npx tsx scripts/init-db.ts
 */

import { initSchema } from '../lib/db/schema';
import { closeDb } from '../lib/db/client';

console.log('🗄️  Initializing database...');
initSchema();
closeDb();
console.log('✅ Done! Database created at ./data/local.db');
