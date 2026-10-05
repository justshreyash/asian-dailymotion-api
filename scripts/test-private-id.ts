import { getDmAccessToken } from '../lib/dailymotion/client';
import * as dotenv from 'dotenv';
import { getDb } from '../lib/db/client';

dotenv.config({ path: '.env' });

async function main() {
  const db = getDb();
  const accounts = db.prepare('SELECT * FROM dm_accounts').all() as any[];
  if (accounts.length === 0) {
    console.log('No accounts');
    return;
  }
  const account = accounts[0];
  const token = await getDmAccessToken(account.api_key, account.api_secret);

  const videoId = 'xbhyd3m';

  const resp = await fetch(`https://partner.api.dailymotion.com/rest/videos/${videoId}?fields=id,private_id,title,url`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const json = await resp.json();
  console.log('Video Data:', json);
}

main();
