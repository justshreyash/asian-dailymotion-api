import 'dotenv/config';
import { FourKHdHubClient } from '../lib/scraper/client';
import { parseAllReleases } from '../lib/scraper/parser';

async function main() {
  const client = new FourKHdHubClient();
  const html = await client.fetchRawHtml('made-in-korea-series-5037/');
  const releases = parseAllReleases(html);
  console.log(`Total releases found: ${releases.length}`);
  
  // Group by episode
  const byEp: Record<string, any[]> = {};
  for (const r of releases) {
    const key = `S${(r as any).season || 1}E${(r as any).episode || 1}`;
    if (!byEp[key]) byEp[key] = [];
    byEp[key].push({
      resolution: r.resolution,
      sizeMb: r.sizeMb,
      title: r.releaseTitle,
      mirrors: r.mirrors?.length || 0,
      audio: r.audioLanguages,
    });
  }

  for (const [ep, rels] of Object.entries(byEp)) {
    console.log(`\n=== ${ep} (${rels.length} releases available) ===`);
    for (const r of rels) {
      console.log(`  - [${r.resolution}] ${r.sizeMb}MB (${r.audio?.join(', ') || 'unknown audio'}): ${r.title}`);
    }
  }
}

main().catch(console.error);
