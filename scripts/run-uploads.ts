/**
 * Upload Pipeline Runner:
 * Iterates through all catalog titles with TMDB IDs, finds missing episodes/movies,
 * and uploads them using the active account swarm with greedy bin-packing safeguards.
 *
 * Usage:
 *   npx tsx scripts/run-uploads.ts
 */

import 'dotenv/config';
import { initSchema } from '../lib/db/schema';
import { runUploads } from '../lib/pipeline/upload';
import { closeDb } from '../lib/db/client';

async function main() {
  console.log('🚀 Starting Swarm Upload Pipeline...');
  await initSchema();

  const maxArg = process.argv.find(a => a.startsWith('--max='));
  const tmdbArg = process.argv.find(a => a.startsWith('--tmdb='));

  const maxUploads = maxArg ? parseInt(maxArg.split('=')[1], 10) : undefined;
  const prioritizeTmdbId = tmdbArg ? parseInt(tmdbArg.split('=')[1], 10) : undefined;

  await runUploads({ maxUploads, prioritizeTmdbId });

  console.log('\n✅ Upload run complete.');
  closeDb();
}

main().catch(err => {
  console.error('Upload pipeline failed:', err);
  closeDb();
  process.exit(1);
});
