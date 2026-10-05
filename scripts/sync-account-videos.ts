/**
 * Syncs existing videos from the Dailymotion channel into the local SQLite database.
 * Parses titles like "305644-1-4" or "961268" and registers them.
 */

import 'dotenv/config';
import { getDb, closeDb } from '../lib/db/client';
import { initSchema } from '../lib/db/schema';
import { getDmAccessToken } from '../lib/dailymotion/client';
import { parseDmTitle } from '../lib/utils/title-format';

async function main() {
  console.log('🔄 Syncing existing Dailymotion videos into SQLite...');
  initSchema();
  const db = getDb();

  const apiKey = process.env.DAILYMOTION_API_KEY!;
  const apiSecret = process.env.DAILYMOTION_API_SECRET!;
  const token = await getDmAccessToken(apiKey, apiSecret);

  // Extract owner ID from token
  const payload = JSON.parse(Buffer.from(token.access_token.split('.')[1], 'base64').toString());
  const ownerId = payload.ooi || 'me';
  console.log(`👤 Channel owner ID: ${ownerId}`);

  // Fetch videos from the channel
  const fields = 'id,title,status,private,private_id,url,embed_url,created_time';
  const res = await fetch(`https://partner.api.dailymotion.com/rest/user/${ownerId}/videos?fields=${fields}&limit=100`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!res.ok) {
    console.error('Failed to list videos:', await res.text());
    return;
  }

  const data = await res.json() as any;
  const list = data.list || [];
  console.log(`Found ${list.length} total videos on channel.\n`);

  let synced = 0;
  let skipped = 0;

  for (const item of list) {
    const parsed = parseDmTitle(item.title);
    if (!parsed) {
      console.log(`⏭️  Skipped "${item.title}" (does not match TMDB numeric title format)`);
      skipped++;
      continue;
    }

    const { tmdbId, isMovie, season, episode } = parsed;
    const dmVideoId = item.private_id || item.id;
    const dmVideoUrl = item.url || `https://www.dailymotion.com/video/${dmVideoId}`;

    // Ensure a title entry exists
    let titleRow = db.prepare('SELECT id FROM titles WHERE tmdb_id = ?').get(tmdbId) as any;
    if (!titleRow) {
      const info = db.prepare(`
        INSERT INTO titles (slug, title, kind, tmdb_id, audio_langs, status)
        VALUES (?, ?, ?, ?, '[]', 'completed')
      `).run(
        `tmdb-${tmdbId}`,
        `Title #${tmdbId}`,
        isMovie ? 'movie' : 'series',
        tmdbId
      );
      titleRow = { id: info.lastInsertRowid };
    }

    // Insert or update video record
    const existing = db.prepare(`
      SELECT id FROM videos 
      WHERE tmdb_id = ? AND (season = ? OR (season IS NULL AND ? IS NULL)) 
                        AND (episode = ? OR (episode IS NULL AND ? IS NULL))
    `).get(tmdbId, season || null, season || null, episode || null, episode || null) as any;

    if (existing) {
      db.prepare(`
        UPDATE videos 
        SET dm_video_id = ?, dm_video_url = ?, dm_title = ?, upload_status = 'uploaded', updated_at = datetime('now')
        WHERE id = ?
      `).run(dmVideoId, dmVideoUrl, item.title, existing.id);
      console.log(`🔄 Updated: ${item.title} (TMDB ${tmdbId}${!isMovie ? ` S${season}E${episode}` : ''}) → ${dmVideoId}`);
    } else {
      db.prepare(`
        INSERT INTO videos (title_id, tmdb_id, season, episode, is_movie, dm_video_id, dm_video_url, dm_title, upload_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')
      `).run(
        titleRow.id,
        tmdbId,
        season || null,
        episode || null,
        isMovie ? 1 : 0,
        dmVideoId,
        dmVideoUrl,
        item.title
      );
      console.log(`✅ Synced: ${item.title} (TMDB ${tmdbId}${!isMovie ? ` S${season}E${episode}` : ''}) → ${dmVideoId}`);
    }

    synced++;
  }

  console.log(`\n🎉 Sync complete! Synced: ${synced}, Skipped: ${skipped}`);
  closeDb();
}

main().catch(err => {
  console.error('Sync failed:', err);
  closeDb();
});
