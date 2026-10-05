import 'dotenv/config';
import { getTakedownVideos, getAllDmAccounts } from '../lib/db/queries';
import { closeDb } from '../lib/db/client';

async function main() {
  const takedowns = await getTakedownVideos();
  console.log(`Total takedown videos: ${takedowns.length}`);
  for (const v of takedowns) {
    console.log({
      id: v.id,
      title: v.title_name,
      tmdb_id: v.tmdb_id,
      season: v.season,
      episode: v.episode,
      resolution: v.resolution,
      file_size_mb: v.file_size_mb,
      source_url: v.source_url,
      dm_video_id: v.dm_video_id,
      reason: v.takedown_reason,
    });
  }
  closeDb();
}

main().catch(console.error);
