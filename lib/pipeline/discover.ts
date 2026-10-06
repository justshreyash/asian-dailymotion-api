/**
 * Pipeline Phase 1: Discovery
 * Scrapes 4KHDHub for new Korean dramas/movies and inserts them into DB.
 */

import { FourKHdHubClient } from '../scraper/client';
import { parseDetails, parseAllReleases, extractPageAudioLanguages } from '../scraper/parser';
import { meetsAudioCriteria } from '../utils/audio-filter';
import { upsertTitle } from '../db/queries';

export async function runDiscovery(maxPages = 15) {
  const client = new FourKHdHubClient();
  let discoveredCount = 0;

  console.log(`\n🔍 Starting Deep Discovery Pipeline (Dramas/Series first, up to ${maxPages} pages per category)...`);

  let allResults: any[] = [];
  // Prioritize Korean Drama and Series categories first
  const categories = ['korean-drama', 'korean-series', 'korean-movies'];

  for (const category of categories) {
    console.log(`\n📂 Scraping category: ${category}`);
    for (let page = 1; page <= maxPages; page++) {
      try {
        const results = await client.listCategory(category, page);
        if (results.length === 0) {
          console.log(`  Page ${page}: No more titles found. End of category.`);
          break;
        }
        console.log(`  Page ${page}: ${results.length} titles`);
        allResults.push(...results);
        await sleep(1000);
      } catch (e) {
        console.log(`  Page ${page} reached end/failed: ${(e as Error).message}`);
        break;
      }
    }
  }

  // Dedupe
  const seen = new Set<string>();
  allResults = allResults.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  console.log(`\n📊 Total unique titles found: ${allResults.length}`);

  for (const item of allResults) {
    try {
      const html = await client.fetchRawHtml(item.id);
      const details = parseDetails(item.id, html);
      
      const pageLangs = extractPageAudioLanguages(html);
      const releases = parseAllReleases(html);
      const releaseLangs = new Set<string>();
      for (const r of releases) {
        for (const lang of r.audioLanguages) {
          releaseLangs.add(lang);
        }
      }
      const allLangs = [...new Set([...pageLangs, ...releaseLangs])];

      if (meetsAudioCriteria(allLangs)) {
        await upsertTitle({
          slug: item.id,
          title: details.title,
          kind: details.kind,
          year: details.year,
          posterUrl: details.posterUrl,
          audioLangs: allLangs,
        });
        discoveredCount++;
        console.log(`  ✅ Added/Updated: ${details.title}`);
      } else {
        console.log(`  ⏭️ Skipped (Non-KR audio): ${details.title}`);
      }

      await sleep(1000);
    } catch (e) {
      console.log(`  ❌ Failed details for ${item.id}: ${(e as Error).message}`);
    }
  }

  console.log(`\n✅ Discovery complete. Qualified titles added: ${discoveredCount}`);
  return discoveredCount;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
