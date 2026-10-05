import 'dotenv/config';
import { getAllDmAccounts, getAllVideos, getStats, getHoldVideos } from '../lib/db/queries';
import { closeDb } from '../lib/db/client';

async function main() {
  const accounts = await getAllDmAccounts();
  console.log('=== DM ACCOUNTS ===');
  for (const a of accounts) {
    console.log({
      id: a.id,
      label: a.label,
      status: a.status,
      is_active: a.is_active,
      strike_count: a.strike_count,
      daily_upload_count: a.daily_upload_count,
      daily_duration_seconds: a.daily_duration_seconds,
      daily_duration_hours: ((a.daily_duration_seconds || 0) / 3600).toFixed(2),
      upload_count: a.upload_count,
      last_used_at: a.last_used_at
    });
  }

  const holds = await getHoldVideos(20);
  console.log(`\n=== VIDEOS ON HOLD (${holds.length}) ===`);
  for (const h of holds) {
    console.log({
      id: h.id,
      title: h.title_name,
      tmdb_id: h.tmdb_id,
      s: h.season,
      e: h.episode,
      reason: h.error_message,
      updated_at: h.updated_at
    });
  }

  const vids = await getAllVideos({ limit: 10 });
  console.log(`\n=== RECENT 10 VIDEOS ===`);
  for (const v of vids) {
    console.log({
      id: v.id,
      title: v.title_name,
      tmdb_id: v.tmdb_id,
      s: v.season,
      e: v.episode,
      status: v.upload_status,
      account_id: v.dm_account_id,
      account: v.account_label,
      dm_id: v.dm_video_id,
      error: v.error_message,
      updated_at: v.updated_at
    });
  }

  const stats = await getStats();
  console.log('\n=== STATS ===', stats);
  closeDb();
}

main().catch(console.error);
