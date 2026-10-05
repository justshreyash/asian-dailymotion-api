import 'dotenv/config';
import { getAllDmAccounts } from '../lib/db/queries';
import { getDmAccessToken, uploadVideoByUrl } from '../lib/dailymotion/client';
import { closeDb } from '../lib/db/client';

async function main() {
  const accounts = await getAllDmAccounts();
  const testUrl = 'https://raw.githubusercontent.com/bower-media-samples/big-buck-bunny-1080p-30s/master/video.mp4';

  console.log('Testing upload capability for all accounts:');
  for (const acc of accounts) {
    console.log(`\n==================================================`);
    console.log(`Account #${acc.id} (${acc.label}) [status: ${acc.status}, is_active: ${acc.is_active}]`);
    try {
      const tokenRes = await getDmAccessToken(acc.api_key, acc.api_secret);
      console.log(`Token received successfully!`);
      
      const parts = tokenRes.access_token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      console.log('JWT Payload:', JSON.stringify(payload, null, 2));

      // Test 1: Upload via partner endpoint with channel/user in body vs without
      console.log('Testing uploadVideoByUrl...');
      const uploadRes = await uploadVideoByUrl(tokenRes.access_token, {
        url: testUrl,
        title: `test-probe-${acc.label}-${Date.now()}`,
        isPrivate: true,
      });

      console.log('Upload Result:', JSON.stringify(uploadRes, null, 2));
    } catch (e) {
      console.log(`Account #${acc.id} threw error:`, (e as Error).message);
    }
  }

  closeDb();
}

main().catch(console.error);
