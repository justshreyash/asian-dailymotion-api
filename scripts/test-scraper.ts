/**
 * Test scraper — scrapes the 4KHDHub Korean drama category and prints results.
 *
 * Run: npx tsx scripts/test-scraper.ts
 *
 * Tests:
 * 1. Category listing (korean-drama)
 * 2. Detail page parsing
 * 3. Audio language extraction
 * 4. Release parsing + size extraction
 * 5. Release selection (smallest 1080p first)
 * 6. Saves qualifying titles to local DB
 */

import { FourKHdHubClient } from '../lib/scraper/client';
import { parseDetails, parseAllReleases, extractPageAudioLanguages } from '../lib/scraper/parser';
import { selectBestReleases, releasesSummary } from '../lib/utils/release-picker';
import { meetsAudioCriteria } from '../lib/utils/audio-filter';
import { initSchema } from '../lib/db/schema';
import { upsertTitle, getAllTitles } from '../lib/db/queries';
import { closeDb } from '../lib/db/client';

async function main() {
  console.log('🎬 4KHDHub Korean Drama Scraper Test\n');
  console.log('='.repeat(60));

  // 1. Init DB
  await initSchema();

  const client = new FourKHdHubClient();

  // 2. List Korean dramas from category (first 2 pages for testing)
  console.log('\n📋 Fetching Korean drama category...\n');

  let allResults: any[] = [];
  for (let page = 1; page <= 2; page++) {
    try {
      const results = await client.listCategory('korean-drama', page);
      console.log(`  Page ${page}: ${results.length} titles found`);
      allResults.push(...results);
      if (results.length === 0) break;
      await sleep(1500);
    } catch (e) {
      console.log(`  Page ${page} failed: ${(e as Error).message}`);
      break;
    }
  }

  // Also try "korean-series" category
  try {
    const results = await client.listCategory('korean-series', 1);
    console.log(`  korean-series page 1: ${results.length} titles found`);
    allResults.push(...results);
  } catch {
    console.log('  korean-series category not found, skipping');
  }

  // Dedupe by slug
  const seen = new Set<string>();
  allResults = allResults.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  console.log(`\n📊 Total unique titles: ${allResults.length}\n`);
  console.log('='.repeat(60));

  // 3. For each title, fetch details and check audio
  let qualifyCount = 0;
  const maxToProcess = Math.min(allResults.length, 5); // Process first 5 for testing

  for (let i = 0; i < maxToProcess; i++) {
    const item = allResults[i];
    console.log(`\n🔍 [${i + 1}/${maxToProcess}] ${item.title} (${item.kind})`);
    console.log(`   Slug: ${item.id}`);

    try {
      // Fetch detail page
      const html = await client.fetchRawHtml(item.id);

      // Parse details
      const details = parseDetails(item.id, html);
      console.log(`   Title: ${details.title}`);
      console.log(`   Year: ${details.year || 'unknown'}`);
      console.log(`   Kind: ${details.kind}`);
      if (details.seasons) {
        console.log(`   Seasons: ${details.seasons.length}`);
        for (const s of details.seasons) {
          console.log(`     S${s.seasonNumber}: ${s.episodes.length} episodes`);
        }
      }

      // Extract audio languages (page-level)
      const pageLangs = extractPageAudioLanguages(html);
      console.log(`   Page Audio: [${pageLangs.join(', ')}]`);

      // Extract release-level audio
      const releases = parseAllReleases(html);
      const releaseLangs = new Set<string>();
      for (const r of releases) {
        for (const lang of r.audioLanguages) {
          releaseLangs.add(lang);
        }
      }
      const allLangs = [...new Set([...pageLangs, ...releaseLangs])];
      console.log(`   All Audio: [${allLangs.join(', ')}]`);

      // Check criteria
      const qualifies = meetsAudioCriteria(allLangs);
      console.log(`   Qualifies (Korean + Hindi/English): ${qualifies ? '✅ YES' : '❌ NO'}`);

      if (qualifies) {
        qualifyCount++;

        // Show release picker
        if (releases.length > 0) {
          console.log(`\n   📦 Releases (${releases.length} total):`);
          for (const r of releases.slice(0, 5)) {
            const size = r.sizeMb ? `${r.sizeMb.toFixed(0)} MB` : r.size || '?';
            console.log(`     ${r.resolution} | ${size} | ${r.releaseTitle.slice(0, 70)}`);
            console.log(`       Audio: [${r.audioLanguages.join(', ')}]`);
            console.log(`       Mirrors: ${r.mirrors.length}`);
          }

          // Run release picker
          const best = selectBestReleases(releases);
          if (best.length > 0) {
            console.log(`\n   🏆 Best release order:`);
            console.log(releasesSummary(best.slice(0, 3)));
          }
        }

        // Save to DB
        upsertTitle({
          slug: item.id,
          title: details.title,
          kind: details.kind,
          year: details.year,
          posterUrl: details.posterUrl,
          audioLangs: allLangs,
        });
        console.log(`   💾 Saved to DB`);
      }

      await sleep(2000); // Rate limit
    } catch (e) {
      console.log(`   ❌ Error: ${(e as Error).message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Summary:`);
  console.log(`   Processed: ${maxToProcess} / ${allResults.length} titles`);
  console.log(`   Qualifying (Korean + Hindi/English): ${qualifyCount}`);

  // Show DB contents
  const dbTitles = await getAllTitles();
  console.log(`\n💾 Database titles (${dbTitles.length}):`);
  for (const t of dbTitles) {
    console.log(`   ${t.id}. ${t.title} (${t.kind}) - ${t.status} - audio: ${t.audio_langs}`);
  }

  closeDb();
  console.log('\n✅ Test complete!\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('Fatal error:', e);
  closeDb();
  process.exit(1);
});
