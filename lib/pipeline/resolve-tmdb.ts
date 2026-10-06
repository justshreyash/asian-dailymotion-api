/**
 * Pipeline Phase 2: TMDB Resolution
 * Runs as part of the cron job or local test script.
 */

import { TmdbClient } from '../tmdb/client';
import { getTitlesWithoutTmdb, updateTitleTmdb, updateTitleStatus } from '../db/queries';

export async function runTmdbResolution() {
  const tmdb = new TmdbClient();
  const titles = await getTitlesWithoutTmdb();

  console.log(`\n🔍 Found ${titles.length} titles needing TMDB resolution`);

  for (const title of titles) {
    console.log(`  Matching: "${title.title}" (${title.kind}, ${title.year || 'unknown year'})`);

    const match = await tmdb.matchTitle(title.title, title.kind, title.year || undefined);

    if (match) {
      const MIN_RELEASE_YEAR = 2024;
      if (match.year != null && match.year < MIN_RELEASE_YEAR) {
        console.log(`    ⏭️ Skipped (TMDB Year ${match.year} < 2024): "${title.title}"`);
        await updateTitleStatus(title.id, 'skipped');
        continue;
      }

      console.log(`    ✅ Matched! TMDB ID: ${match.tmdbId} (Year: ${match.year || 'unknown'}, Status: ${match.airingStatus || 'Ended'}, OnAir: ${match.isOnAir})`);
      await updateTitleTmdb(title.id, match.tmdbId, match.seasons, match.episodes, {
        year: match.year,
        isOnAir: match.isOnAir,
        airingStatus: match.airingStatus,
        nextAirDate: match.nextAirDate,
        lastAirDate: match.lastAirDate,
        posterUrl: match.posterUrl,
      });
    } else {
      console.log(`    ❌ No match found. Marking as failed.`);
      await updateTitleStatus(title.id, 'failed');
    }

    // Rate limiting (TMDB allows 40 req / 10 sec = 4 req / sec max)
    await sleep(300);
  }

  console.log('✅ TMDB resolution complete');
}

export async function syncAiringSeriesDetails() {
  const tmdb = new TmdbClient();
  const { getAllTitles, updateTitleAiringInfo } = await import('../db/queries');
  const allTitles = await getAllTitles();
  const series = allTitles.filter(t => t.tmdb_id != null && t.kind === 'series');

  console.log(`\n📡 Syncing TMDB airing status for ${series.length} series...`);
  let onAirCount = 0;

  for (const title of series) {
    try {
      const details = await tmdb.getTvDetails(title.tmdb_id!);
      const isOnAir = Boolean(details.in_production || details.status === 'Returning Series');
      const tvYearStr = details.first_air_date;
      const tvYear = tvYearStr ? parseInt(tvYearStr.slice(0, 4), 10) : undefined;
      
      await updateTitleAiringInfo(title.id, {
        year: tvYear,
        isOnAir,
        airingStatus: details.status,
        nextAirDate: details.next_episode_to_air?.air_date,
        lastAirDate: details.last_air_date || details.last_episode_to_air?.air_date,
        totalEpisodes: details.number_of_episodes,
      });

      if (isOnAir) {
        onAirCount++;
        console.log(`  🔥 On-Air: "${title.title}" - Status: ${details.status}, Next: ${details.next_episode_to_air?.air_date || 'TBA'}`);
      }

      await sleep(250);
    } catch (e) {
      console.log(`  ⚠️ Could not update TMDB status for "${title.title}": ${(e as Error).message}`);
    }
  }

  console.log(`✅ Airing status sync complete. ${onAirCount} on-air series tracked.`);
  return onAirCount;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
