import 'dotenv/config';
import { getAllVideos, getAllDmAccounts } from '../lib/db/queries';
import { closeDb } from '../lib/db/client';

async function main() {
  const vids = await getAllVideos();
  const accounts = await getAllDmAccounts();
  console.log(`Total videos in DB: ${vids.length}`);
  console.log(`Total accounts in DB: ${accounts.length}`);

  const target = 'xbiami6';
  const match = vids.find(v => v.dm_video_id === target || (v.dm_video_url && v.dm_video_url.includes(target)));

  if (match) {
    console.log('\n🚨 FOUND SUSPENDED VIDEO IN DB:');
    console.log(match);
  } else {
    console.log(`\nVideo ${target} was not found by exact ID in database. Checking all uploaded DM IDs:`);
    for (const v of vids) {
      console.log(`- TMDB: ${v.tmdb_id} | S${v.season}E${v.episode} | DM ID: ${v.dm_video_id} | Title: ${v.title_name || v.dm_title} | Account: ${v.account_label}`);
    }
  }

  closeDb();
}

main().catch(console.error);
