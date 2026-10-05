/**
 * Phase 1 & 2 Execution Script:
 * 1. Crawls 4KHDHub Korean drama, series, and movie categories
 * 2. Filters by audio languages (Korean, Hindi, English)
 * 3. Saves discovered titles to SQLite
 * 4. Resolves TMDB IDs and episode/season counts
 */

import 'dotenv/config';
import { initSchema } from '../lib/db/schema';
import { getDb, closeDb } from '../lib/db/client';
import { runDiscovery } from '../lib/pipeline/discover';
import { runTmdbResolution } from '../lib/pipeline/resolve-tmdb';

async function main() {
  console.log('🚀 Starting Catalog Discovery & TMDB Resolution');
  initSchema();

  // Pages to scrape per category (default: 3 pages ~ 54 titles per category)
  const maxPages = parseInt(process.env.DISCOVERY_PAGES || '3', 10);

  console.log('\n=======================================');
  console.log(`PHASE 1: 4KHDHub Discovery (${maxPages} pages/category)`);
  console.log('=======================================');
  const count = await runDiscovery(maxPages);
  console.log(`\n🎉 Discovery phase complete. Found ${count} qualifying titles.`);

  console.log('\n=======================================');
  console.log('PHASE 2: TMDB ID & Metadata Resolution');
  console.log('=======================================');
  await runTmdbResolution();

  // Print summary from DB
  const db = getDb();
  const summary = db.prepare(`
    SELECT kind, COUNT(*) as total, 
           SUM(CASE WHEN tmdb_id IS NOT NULL THEN 1 ELSE 0 END) as matched,
           SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) as ready
    FROM titles
    GROUP BY kind
  `).all() as any[];

  console.log('\n📊 Catalog Summary:');
  console.table(summary);

  closeDb();
}

main().catch(err => {
  console.error('Fatal error in discovery:', err);
  closeDb();
  process.exit(1);
});
