import 'dotenv/config';
import { dbAll, dbRun, dbGet } from '../lib/db/client';
import { markVideoTakedown, incrementAccountStrike } from '../lib/db/queries';

async function scan() {
  console.log('🔍 Auditing all uploaded videos against Dailymotion API...');

  const videos = await dbAll<any>(`
    SELECT id, tmdb_id, season, episode, dm_video_id, dm_account_id, upload_status 
    FROM videos 
    WHERE upload_status = 'uploaded' AND dm_video_id IS NOT NULL
  `);

  console.log(`Found ${videos.length} uploaded videos to audit.`);
  let takedownsFound = 0;

  for (const v of videos) {
    try {
      const res = await fetch(`https://api.dailymotion.com/video/${v.dm_video_id}?fields=id,title,status`);
      const data = await res.json().catch(() => null);

      if (res.status === 404 || data?.error?.code === 404 || data?.status === 'deleted' || data?.status === 'encoding_error') {
        takedownsFound++;
        const reason = data?.status === 'encoding_error' 
          ? 'Dailymotion Transcoding Encoding Error'
          : 'Flagged by Dailymotion Automated Fingerprint Recognition (HTTP 404 Deleted)';
        
        console.warn(`  🚨 SUSPENDED VIDEO FOUND: ID #${v.id} (DM: ${v.dm_video_id}, Public: ${data?.id || 'deleted'}, TMDB: ${v.tmdb_id})`);
        console.warn(`     Reason: ${reason}`);

        await markVideoTakedown(v.id, reason);
      } else {
        console.log(`  ✅ Healthy: ID #${v.id} (${v.dm_video_id}) -> ${data?.status || 'published'}`);
      }
    } catch (e) {
      console.warn(`  ⚠️ Could not check ID #${v.id}:`, (e as Error).message);
    }
  }

  console.log(`\n🎉 Audit finished! Found and flagged ${takedownsFound} suspended/takedown videos.`);
}

scan().catch(console.error);
