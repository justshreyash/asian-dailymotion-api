import 'dotenv/config';
import { dbRun } from '../lib/db/client';
import { getTitleByTmdbId, getVideosByTmdbId, updateTitleStatus, getAllDmAccounts } from '../lib/db/queries';

async function cleanup() {
  console.log('--- Cleaning DB & Resetting Account Strikes ---');

  // 1. Reset strikes on dm-2, dm-3, dm-4, dm-5
  await dbRun(`
    UPDATE dm_accounts SET
      strike_count = 0,
      status = 'active',
      is_active = 1
    WHERE label IN ('dm-2', 'dm-3', 'dm-4', 'dm-5')
  `);
  console.log('Swarm nodes dm-2, dm-3, dm-4, dm-5 reset to active with 0 strikes.');

  // 2. Set TMDB 291496 and 282810 to 'processing'
  const title291496 = await getTitleByTmdbId(291496);
  if (title291496) {
    await updateTitleStatus(title291496.id, 'processing');
    console.log(`Title 291496 ("${title291496.title}") set to 'processing'.`);
  }

  const title282810 = await getTitleByTmdbId(282810);
  if (title282810) {
    await updateTitleStatus(title282810.id, 'processing');
    console.log(`Title 282810 ("${title282810.title}") set to 'processing'.`);
  }

  // 3. Reset all episodes of 291496 to pending
  await dbRun(`
    UPDATE videos SET
      upload_status = 'pending',
      dm_account_id = NULL,
      dm_video_id = NULL,
      dm_video_url = NULL,
      source_url = NULL,
      error_message = NULL,
      updated_at = datetime('now')
    WHERE tmdb_id = 291496
  `);
  console.log('All episodes of TMDB 291496 reset to pending for clean release upload.');

  // 4. Verify account status
  const accounts = await getAllDmAccounts();
  console.log('Current Swarm Accounts:', accounts.map(a => ({ id: a.id, label: a.label, active: a.is_active, status: a.status, strikes: a.strike_count })));

  // 5. Verify TMDB 291496 videos
  const vids291496 = await getVideosByTmdbId(291496);
  console.log(`TMDB 291496 videos count: ${vids291496.length}`);
  console.log(vids291496.map(v => ({ ep: v.episode, status: v.upload_status, dmId: v.dm_video_id })));
}

cleanup().catch(console.error);
