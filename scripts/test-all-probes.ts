import 'dotenv/config';
import { getAllDmAccounts } from '../lib/db/queries';
import { getDmAccessToken, uploadVideoByUrl } from '../lib/dailymotion/client';
import { closeDb } from '../lib/db/client';

async function main() {
  const accounts = await getAllDmAccounts();
  const testUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

  for (const acc of accounts) {
    console.log(`\nTesting probe upload on account #${acc.id}: "${acc.label}"...`);
    try {
      const tokenRes = await getDmAccessToken(acc.api_key, acc.api_secret);
      const res = await uploadVideoByUrl(tokenRes.access_token, {
        url: testUrl,
        title: 'test-rate-probe',
        isPrivate: true,
      });
      console.log(`  Result for "${acc.label}":`, res.success ? `SUCCESS! ID: ${res.videoId}` : res.error);
    } catch (e) {
      console.log(`  Error for "${acc.label}":`, (e as Error).message);
    }
  }
  closeDb();
}

main().catch(console.error);
