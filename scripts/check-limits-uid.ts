import 'dotenv/config';
import { getAllDmAccounts } from '../lib/db/queries';
import { getDmAccessToken } from '../lib/dailymotion/client';
import { closeDb } from '../lib/db/client';

async function main() {
  const accounts = await getAllDmAccounts();
  for (const acc of accounts) {
    try {
      const token = await getDmAccessToken(acc.api_key, acc.api_secret);
      const parts = token.access_token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const uid = payload.ooi || payload.oid || payload.sub;

      const res = await fetch(`https://api.dailymotion.com/user/${uid}?fields=id,username,screenname,status,videos_total,limits`, {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const data = await res.json();
      console.log(`Account #${acc.id} (${acc.label}, uid: ${uid}):`, JSON.stringify(data, null, 2));
    } catch (e) {
      console.log(`Account #${acc.id} error:`, (e as Error).message);
    }
  }
  closeDb();
}

main().catch(console.error);
