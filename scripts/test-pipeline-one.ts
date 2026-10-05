/**
 * Tests the full pipeline end-to-end for a single movie or series.
 */

import 'dotenv/config';
import { initSchema } from '../lib/db/schema';
import { closeDb } from '../lib/db/client';
import { upsertTitle, getAllDmAccounts, addDmAccount, getTitleBySlug } from '../lib/db/queries';
import { runTmdbResolution } from '../lib/pipeline/resolve-tmdb';
import { runUploads } from '../lib/pipeline/upload';

async function main() {
  console.log('🎬 Single Movie Pipeline Test (Ballerina)');

  await initSchema();

  // Seed DM account if empty
  let accounts = await getAllDmAccounts();
  if (accounts.length === 0) {
    const apiKey = process.env.DAILYMOTION_API_KEY;
    const apiSecret = process.env.DAILYMOTION_API_SECRET;
    if (apiKey && apiSecret) {
      await addDmAccount({
        label: 'test-account-1',
        apiKey,
        apiSecret,
      });
      console.log('✅ Seeded DM account from .env');
    } else {
      console.log('❌ No DM API credentials found in .env');
      process.exit(1);
    }
  }

  // 1. Ensure Ballerina is in catalog
  const title = await upsertTitle({
    slug: 'ballerina-movie-3878',
    title: 'Ballerina',
    kind: 'movie',
    year: 2023,
    audioLangs: ['korean', 'hindi', 'english'],
  });
  console.log('✅ Added / verified Ballerina in database');

  // 2. Run TMDB Resolution
  console.log('\n=======================================');
  console.log('TMDB RESOLUTION');
  console.log('=======================================');
  await runTmdbResolution();

  // 3. Run Uploads
  console.log('\n=======================================');
  console.log('DAILYMOTION UPLOAD');
  console.log('=======================================');
  const updated = await getTitleBySlug('ballerina-movie-3878');
  if (updated?.tmdb_id) {
    await runUploads({ prioritizeTmdbId: updated.tmdb_id, maxUploads: 1 });
  }

  console.log('\n✅ Single pipeline run complete.');
  closeDb();
}

main().catch(e => {
  console.error('Fatal error:', e);
  closeDb();
  process.exit(1);
});
