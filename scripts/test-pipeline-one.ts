/**
 * Tests the full pipeline end-to-end for a single movie (Ballerina).
 */

import { initSchema } from '../lib/db/schema';
import { getDb, closeDb } from '../lib/db/client';
import { upsertTitle } from '../lib/db/queries';
import { runTmdbResolution } from '../lib/pipeline/resolve-tmdb';
import { runUploads } from '../lib/pipeline/upload';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' }); // Fallback

async function main() {
  console.log('🎬 Single Movie Pipeline Test (Ballerina)');

  initSchema();

  // 1. Clear existing titles to ensure we only process Ballerina
  const db = getDb();
  db.prepare('DELETE FROM videos').run();
  db.prepare('DELETE FROM titles').run();
  console.log('🧹 Cleared existing DB records for test.');

  // Seed DM account if empty
  let accounts = db.prepare('SELECT * FROM dm_accounts').all();
  if (accounts.length === 0) {
    const apiKey = process.env.DAILYMOTION_API_KEY;
    const apiSecret = process.env.DAILYMOTION_API_SECRET;
    if (apiKey && apiSecret) {
      db.prepare(`
        INSERT INTO dm_accounts (label, api_key, api_secret)
        VALUES (?, ?, ?)
      `).run('test-account-1', apiKey, apiSecret);
      console.log('✅ Seeded DM account from .env');
    } else {
      console.log('❌ No DM API credentials found in .env');
      process.exit(1);
    }
  }

  // 2. Manually insert Ballerina (Simulating Phase 1 Discovery)
  const title = upsertTitle({
    slug: 'ballerina-movie-3878',
    title: 'Ballerina',
    kind: 'movie',
    year: 2023,
    audioLangs: ['korean', 'hindi', 'english'],
  });
  console.log('✅ Added Ballerina to database');

  // 3. Run TMDB Resolution (Phase 2)
  console.log('\n=======================================');
  console.log('TMDB RESOLUTION');
  console.log('=======================================');
  await runTmdbResolution();

  // 4. Run Uploads (Phase 3/4)
  console.log('\n=======================================');
  console.log('DAILYMOTION UPLOAD');
  console.log('=======================================');
  await runUploads();

  // 5. Test the local API Route directly
  console.log('\n=======================================');
  console.log('API ROUTE TEST');
  console.log('=======================================');
  
  try {
    const updatedTitle = db.prepare('SELECT tmdb_id FROM titles WHERE id = ?').get(title.id) as any;
    const tmdbId = updatedTitle.tmdb_id;
    console.log(`Fetching from local API: http://localhost:3000/ko/${tmdbId}`);
    const res = await fetch(`http://localhost:3000/ko/${tmdbId}`);
    
    if (res.ok) {
      const data = await res.json();
      console.log('\n🎉 API Response:');
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`❌ API Error: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.log(text);
    }
  } catch (err) {
    console.log('❌ Could not connect to local server. Make sure `npm run dev` is running!');
    console.log((err as Error).message);
  }

  closeDb();
}

main().catch(e => {
  console.error('Fatal error:', e);
  closeDb();
  process.exit(1);
});
