/**
 * Initialize the database with schema (local SQLite or Turso Cloud).
 * Run: npx tsx scripts/init-db.ts
 */

import 'dotenv/config';
import { initSchema } from '../lib/db/schema';
import { closeDb } from '../lib/db/client';

async function main() {
  console.log('🗄️  Initializing database...');
  await initSchema();
  closeDb();
  console.log('✅ Done! Database schema verified and active.');
}

main().catch(err => {
  console.error('Database initialization failed:', err);
  closeDb();
  process.exit(1);
});
