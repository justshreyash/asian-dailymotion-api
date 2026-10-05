import 'dotenv/config';
import { dbRun, closeDb } from '../lib/db/client';
import { getTakedownVideos } from '../lib/db/queries';

async function main() {
  try {
    await dbRun("ALTER TABLE videos ADD COLUMN flagged_sources TEXT DEFAULT '[]';");
    console.log('Added column flagged_sources to videos table.');
  } catch (e) {
    console.log('Column flagged_sources already exists or alter skipped:', (e as Error).message);
  }

  const takedowns = await getTakedownVideos();
  console.log(`Populating flagged_sources for ${takedowns.length} takedown videos...`);

  for (const v of takedowns) {
    let list: any[] = [];
    try {
      list = JSON.parse(v.flagged_sources || '[]');
    } catch {}

    if (v.source_url && !list.some(item => item.url === v.source_url)) {
      list.push({
        url: v.source_url,
        sizeMb: v.file_size_mb,
        resolution: v.resolution,
        reason: v.takedown_reason || 'Fingerprint Recognition Suspension',
        flaggedAt: v.takedown_detected_at || new Date().toISOString(),
      });
      await dbRun("UPDATE videos SET flagged_sources = ? WHERE id = ?", [JSON.stringify(list), v.id]);
      console.log(`Video #${v.id} (TMDB ${v.tmdb_id} S${v.season}E${v.episode}) archived source (${v.file_size_mb}MB, ${v.resolution}) into flagged_sources.`);
    }
  }

  closeDb();
}

main().catch(console.error);
