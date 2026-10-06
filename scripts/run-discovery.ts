/**
 * Phase 1 & 2 Execution Script:
 * 1. Crawls 4KHDHub Korean drama, series, and movie categories
 * 2. Filters by audio languages (Korean, Hindi, English)
 * 3. Saves discovered titles to database
 * 4. Resolves TMDB IDs and episode/season counts
 */

import 'dotenv/config';
import { initSchema } from '../lib/db/schema';
import { closeDb } from '../lib/db/client';
import { getAllTitles } from '../lib/db/queries';
import { runDiscovery } from '../lib/pipeline/discover';
import { runTmdbResolution, syncAiringSeriesDetails } from '../lib/pipeline/resolve-tmdb';

async function main() {
  console.log('🚀 Starting Catalog Discovery & TMDB Resolution');
  await initSchema();

  // Pages to scrape per category (default: 15 pages to cover all releases down to 2024/2020)
  const pageArg = process.argv.find(a => a.startsWith('--pages='));
  const maxPages = pageArg ? parseInt(pageArg.split('=')[1], 10) : parseInt(process.env.DISCOVERY_PAGES || '15', 10);

  console.log('\n=======================================');
  console.log(`PHASE 1: 4KHDHub Discovery (${maxPages} pages/category - Dramas/Series prioritized)`);
  console.log('=======================================');
  const count = await runDiscovery(maxPages);
  console.log(`\n🎉 Discovery phase complete. Found ${count} qualifying titles.`);

  console.log('\n=======================================');
  console.log('PHASE 2: TMDB ID & Metadata Resolution');
  console.log('=======================================');
  await runTmdbResolution();
  await syncAiringSeriesDetails();

  // Print summary from DB
  const allTitles = await getAllTitles();
  const series = allTitles.filter(t => t.kind === 'series');
  const movies = allTitles.filter(t => t.kind === 'movie');

  console.log('\n📊 Catalog Summary:');
  console.log(`   - Series: ${series.length} (${series.filter(s => s.tmdb_id).length} matched TMDB)`);
  console.log(`   - Movies: ${movies.length} (${movies.filter(m => m.tmdb_id).length} matched TMDB)`);
  console.log(`   - Total:  ${allTitles.length}`);

  closeDb();
}

main().catch(err => {
  console.error('Fatal error in discovery:', err);
  closeDb();
  process.exit(1);
});
