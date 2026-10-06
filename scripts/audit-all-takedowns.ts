import 'dotenv/config';
import { dbAll, dbRun } from '../lib/db/client';
import { checkDmVideoHealth } from '../lib/dailymotion/health';

async function auditTakedowns() {
  const takedowns = await dbAll<any>('SELECT v.*, t.title as title_name FROM videos v LEFT JOIN titles t ON v.title_id = t.id WHERE v.upload_status = \'takedown\'');
  console.log(`Found ${takedowns.length} takedown records in DB:`);

  for (const v of takedowns) {
    if (!v.dm_video_id) {
      console.log(` - Video #${v.id} has no dm_video_id`);
      continue;
    }

    const health = await checkDmVideoHealth(v.dm_video_id);
    console.log(` - [${v.dm_video_id}] "${v.title_name}" S${v.season}E${v.episode} | Health result: alive=${health.alive}, status=${health.status}, reason=${health.reason}`);

    if (health.alive) {
      console.log(`   ✅ Video #${v.id} is actually ALIVE! Restoring to 'uploaded'...`);
      await dbRun(`
        UPDATE videos SET
          upload_status = 'uploaded',
          takedown_reason = NULL,
          takedown_detected_at = NULL,
          error_message = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `, [v.id]);

      if (v.title_id) {
        await dbRun(`
          UPDATE titles SET
            status = 'processing',
            updated_at = datetime('now')
          WHERE id = ? AND status = 'blacklisted'
        `, [v.title_id]);
        console.log(`   ✅ Restored Title #${v.title_id} from 'blacklisted' to 'processing'.`);
      }
    }
  }

  // Also check if any account has false strikes
  await dbRun(`
    UPDATE dm_accounts SET
      strike_count = 0,
      status = 'active',
      is_active = 1
    WHERE label IN ('shreyash1441', 'test-account-1', 'dm-2', 'dm-3', 'dm-4', 'dm-5')
  `);
  console.log('Reset all swarm account strikes to 0.');
}

auditTakedowns().catch(console.error);
