/**
 * Test upload script — resolves HubCloud links and uploads one video to Dailymotion.
 *
 * Run: npx tsx scripts/test-upload.ts
 */

import { FourKHdHubClient } from '../lib/scraper/client';
import { DmSwarm } from '../lib/dailymotion/swarm';
import { addDmAccount, getActiveDmAccounts } from '../lib/db/queries';
import { initSchema } from '../lib/db/schema';
import { closeDb } from '../lib/db/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  console.log('🎬 Dailymotion Upload Test\n');

  initSchema();

  // 1. Ensure we have a DM account
  let accounts = getActiveDmAccounts();
  if (accounts.length === 0) {
    console.log('No active DM accounts found in DB. Checking env...');
    const apiKey = process.env.DAILYMOTION_API_KEY;
    const apiSecret = process.env.DAILYMOTION_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.log('❌ DM credentials missing in .env.local');
      console.log('Need: DAILYMOTION_API_KEY, DAILYMOTION_API_SECRET');
      process.exit(1);
    }

    addDmAccount({
      label: 'test-account-1',
      apiKey,
      apiSecret,
    });
    accounts = getActiveDmAccounts();
    console.log(`✅ Added test account "${accounts[0].label}" to DB`);
  } else {
    console.log(`✅ Found ${accounts.length} active DM accounts in DB`);
  }

  // 2. Resolve a HubCloud link (using Ballerina's smallest release as a test)
  console.log('\n🔍 Resolving HubCloud direct URL for "Ballerina"...');
  const client = new FourKHdHubClient();

  // We know from previous test that Ballerina has this URL:
  const testUrl = 'https://hubdrive.wtf/drive/tLdI0NixH57sUe5B6a9ZfQ281u01M6bL2NfLhRjR/135905/';

  console.log(`   Input URL: ${testUrl}`);
  let directUrl: string;
  try {
    const info = await client.resolveRelease({
      id: 'test',
      resolution: '1080p',
      sizeMb: 770,
      mediaTags: [],
      source: 'HubDrive',
      releaseTitle: 'Ballerina (NF 1080p WEB-DL AV1)',
      mirrors: [testUrl],
      audioLanguages: [],
    });
    directUrl = info.url;
    console.log(`   ✅ Resolved Direct URL: ${directUrl.slice(0, 100)}...`);
  } catch (e) {
    console.log(`   ❌ Resolution failed: ${(e as Error).message}`);
    process.exit(1);
  }

  // 3. Upload to DM
  console.log('\n🚀 Uploading to Dailymotion via Swarm...');
  const swarm = new DmSwarm();

  const dmTitle = 'm-1126166'; // Ballerina TMDB ID
  console.log(`   Title: ${dmTitle}`);

  const result = await swarm.upload(directUrl, dmTitle);

  if (result.success) {
    console.log('\n🎉 Upload Successful!');
    console.log(`   Account: ${result.accountLabel} (ID: ${result.accountId})`);
    console.log(`   Video ID: ${result.videoId}`);
    console.log(`   Video URL: ${result.videoUrl}`);
  } else {
    console.log(`\n❌ Upload Failed: ${result.error}`);
  }

  closeDb();
}

main().catch(e => {
  console.error('Fatal error:', e);
  closeDb();
  process.exit(1);
});
