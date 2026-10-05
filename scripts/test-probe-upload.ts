import 'dotenv/config';
import { getAllDmAccounts } from '../lib/db/queries';
import { getDmAccessToken, uploadVideoByUrl } from '../lib/dailymotion/client';
import { closeDb } from '../lib/db/client';

async function main() {
  const accounts = await getAllDmAccounts();
  // Test upload on dm-3 (id: 4) with a public test mp4
  const acc = accounts.find(a => a.id === 4) || accounts[2];
  console.log(`Testing test upload on account "${acc.label}" (id: ${acc.id})...`);

  const tokenRes = await getDmAccessToken(acc.api_key, acc.api_secret);
  console.log('Got token for:', acc.label);

  const testUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
  const res = await uploadVideoByUrl(tokenRes.access_token, {
    url: testUrl,
    title: 'test-upload-probe',
    isPrivate: true,
  });

  console.log('Upload result:', res);
  closeDb();
}

main().catch(console.error);
