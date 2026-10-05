import 'dotenv/config';
import { dbAll, dbRun } from '../lib/db/client';
import { checkDmVideoHealth } from '../lib/dailymotion/health';

async function main() {
  console.log('🔍 Auditing all uploaded videos in DB against Dailymotion API...\n');
  const videos = await dbAll<any>('SELECT * FROM videos WHERE upload_status = ?', ['uploaded']);
  console.log(`Found ${videos.length} videos with status = 'uploaded'.\n`);

  for (const v of videos) {
    if (!v.dm_video_id) continue;
    try {
      const res = await fetch(`https://api.dailymotion.com/video/${v.dm_video_id}?fields=id,title,status,encoding_progress,publishing_progress,mode,duration,available_formats,private,published`);
      const data = await res.json();
      
      if (res.status === 404 || data.error) {
        console.log(`❌ [404/DELETED] Video #${v.id} (TMDB ${v.tmdb_id} S${v.season}E${v.episode}) ID: ${v.dm_video_id}`);
      } else if (data.status === 'encoding_error' || data.encoding_progress === -1) {
        console.log(`🚨 [ENCODING_ERROR] Video #${v.id} (TMDB ${v.tmdb_id} S${v.season}E${v.episode}) ID: ${v.dm_video_id} - status: ${data.status}`);
      } else if (data.published === true && data.status === 'published') {
        console.log(`✅ [HEALTHY] Video #${v.id} (TMDB ${v.tmdb_id} S${v.season}E${v.episode}) ID: ${v.dm_video_id} - ${data.duration}s - formats: ${data.available_formats?.join(', ')}`);
      } else {
        console.log(`⚠️ [OTHER] Video #${v.id} (TMDB ${v.tmdb_id} S${v.season}E${v.episode}) ID: ${v.dm_video_id} - status: ${data.status} - published: ${data.published}`);
      }
    } catch (e: any) {
      console.log(`Fetch error for ${v.dm_video_id}:`, e.message);
    }
  }
}

main().catch(console.error);
