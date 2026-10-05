import 'dotenv/config';
import { getAllTitles, getAllDmAccounts, getAllVideos, getTitleByTmdbId, getVideoByLookup } from '../lib/db/queries';

async function test() {
  console.log('Testing DB queries...');
  const [titles, accounts, videos] = await Promise.all([
    getAllTitles(),
    getAllDmAccounts(),
    getAllVideos(),
  ]);

  console.log(`✅ Loaded from Database:`);
  console.log(`   - Titles:   ${titles.length}`);
  console.log(`   - Accounts: ${accounts.length}`);
  console.log(`   - Videos:   ${videos.length}`);

  // Test single lookup
  const singleTitle = await getTitleByTmdbId(314939);
  console.log(`   - Test TMDB 314939 title: "${singleTitle?.title}" (On-Air: ${singleTitle?.is_on_air})`);

  const singleEp = await getVideoByLookup(314939, 1, 1);
  console.log(`   - Test S1E1 video: DM ID ${singleEp?.dm_video_id}`);
}

test().catch(console.error);
