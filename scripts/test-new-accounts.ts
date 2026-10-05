import 'dotenv/config';
import { getAllDmAccounts } from '../lib/db/queries';
import { getDmAccessToken, checkVideoStatus } from '../lib/dailymotion/client';
import { closeDb } from '../lib/db/client';

async function main() {
  const accounts = await getAllDmAccounts();
  console.log(`Testing all ${accounts.length} DM accounts API credentials...`);

  for (const acc of accounts) {
    console.log(`\n------------------------------------------------`);
    console.log(`Testing Account #${acc.id}: "${acc.label}" (status: ${acc.status}, is_active: ${acc.is_active})`);
    try {
      const tokenRes = await getDmAccessToken(acc.api_key, acc.api_secret);
      console.log(`  🔑 Token Success! Expires in: ${tokenRes.expires_in}s, Scope: ${tokenRes.scope}`);
      
      // Decode JWT payload
      const parts = tokenRes.access_token.split('.');
      if (parts.length > 1) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const uid = payload.ooi || payload.oid || payload.sub;
        console.log(`  👤 JWT User ID: ${uid}`);
        
        // Fetch user info from Dailymotion API
        const userRes = await fetch(`https://api.dailymotion.com/user/${uid}?fields=id,username,screenname,url,status`);
        const userData = await userRes.json();
        console.log(`  📺 Channel Profile:`, userData);
      }
    } catch (e) {
      console.log(`  ❌ FAILED: ${(e as Error).message}`);
    }
  }

  closeDb();
}

main().catch(console.error);
