import 'dotenv/config';
import { dbAll, dbRun, closeDb } from '../lib/db/client';
import { getActiveDmAccounts, getAllDmAccounts, updateTitleStatus } from '../lib/db/queries';
import { getDmAccessToken, checkVideoStatus, deleteDmVideo } from '../lib/dailymotion/client';

export async function runAuditAndHeal() {
  console.log('🩺 Starting Swarm Video Health Audit & Auto-Healer...');

  const allAccounts = await getAllDmAccounts();
  const tokenMap = new Map<number, string>();

  for (const a of allAccounts) {
    try {
      const token = await getDmAccessToken(a.api_key, a.api_secret);
      tokenMap.set(a.id, token.access_token);
    } catch (e) {
      // ignore
    }
  }

  const defaultToken = Array.from(tokenMap.values())[0];
  if (!defaultToken) {
    console.error('No valid DM account tokens found');
    return;
  }

  const uploadedVideos = await dbAll(
    `SELECT v.*, t.title as title_name, t.slug as title_slug 
     FROM videos v 
     JOIN titles t ON v.title_id = t.id 
     WHERE v.upload_status = 'uploaded'
     ORDER BY v.id DESC`
  );

  console.log(`🔍 Auditing ${uploadedVideos.length} uploaded videos across Dailymotion nodes...\n`);

  let healthyCount = 0;
  let processingCount = 0;
  let healedCount = 0;

  for (const v of uploadedVideos) {
    const token = (v.dm_account_id && tokenMap.get(v.dm_account_id)) || defaultToken;
    if (!v.dm_video_id) continue;

    try {
      const status = await checkVideoStatus(token, v.dm_video_id);

      if (!status || status.status === 'encoding_error' || status.encoding_progress === -1) {
        console.log(`🚨 ENCODING ERROR DETECTED: [${v.title_name}] S${v.season ?? ''}E${v.episode ?? ''} (${v.dm_video_id})`);
        console.log(`   - Status: ${status?.status || 'NOT_FOUND'}, Encoding Progress: ${status?.encoding_progress}`);
        
        // 1. Delete the broken video from Dailymotion
        await deleteDmVideo(token, v.dm_video_id);
        console.log(`   🗑️ Deleted corrupted video ${v.dm_video_id} from DM.`);

        // 2. Add current release size/source to flagged_sources
        let flagged: any[] = [];
        if (v.flagged_sources) {
          try { flagged = JSON.parse(v.flagged_sources); } catch {}
        }
        if (v.file_size_mb || v.source_url) {
          flagged.push({
            sizeMb: v.file_size_mb,
            url: v.source_url,
            reason: 'Dailymotion encoding error / incompatible HDR-DV profile',
            timestamp: new Date().toISOString(),
          });
        }

        // 3. Reset DB video record to pending so pipeline picks working alternative
        await dbRun(
          `UPDATE videos 
           SET upload_status = 'pending', 
               dm_video_id = NULL, 
               dm_video_url = NULL, 
               error_message = 'Auto-healed from encoding_error. Queued for clean H.264/SDR re-upload.',
               flagged_sources = ?
           WHERE id = ?`,
          [JSON.stringify(flagged), v.id]
        );

        // 4. Ensure title status is 'processing'
        await updateTitleStatus(v.title_id, 'processing');
        console.log(`   🔄 Auto-healed: Reset to pending for clean re-upload with alternative release.\n`);
        healedCount++;

      } else if (status.status === 'published') {
        healthyCount++;
        // Update duration if missing
        if (status.duration && status.duration > 0 && !v.duration_seconds) {
          await dbRun('UPDATE videos SET duration_seconds = ? WHERE id = ?', [status.duration, v.id]);
        }
        console.log(`✅ [HEALTHY] ${v.title_name} S${v.season ?? ''}E${v.episode ?? ''} (${v.dm_video_id}) - ${Math.round((status.duration || 0)/60)}m, ${status.available_formats?.length || 0} formats`);

      } else {
        processingCount++;
        console.log(`⏳ [ENCODING IN PROGRESS] ${v.title_name} S${v.season ?? ''}E${v.episode ?? ''} (${v.dm_video_id}) - Status: ${status.status}, Progress: ${status.encoding_progress}%`);
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.log(`⚠️ Check failed for video ${v.dm_video_id}: ${(err as Error).message}`);
    }
  }

  console.log('\n=======================================');
  console.log(`📊 Swarm Video Health Audit Summary:`);
  console.log(`   - Healthy & Published: ${healthyCount}`);
  console.log(`   - Currently Transcoding: ${processingCount}`);
  console.log(`   - Corrupted & Auto-Healed: ${healedCount}`);
  console.log('=======================================\n');

  return { healthyCount, processingCount, healedCount };
}

if (require.main === module) {
  runAuditAndHeal()
    .then(() => closeDb())
    .catch(err => {
      console.error(err);
      closeDb();
      process.exit(1);
    });
}
