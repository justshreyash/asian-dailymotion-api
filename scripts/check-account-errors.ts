import 'dotenv/config';
import { dbAll, closeDb } from '../lib/db/client';

async function main() {
  const vids = await dbAll("SELECT id, dm_account_id, dm_video_id, upload_status, error_message, updated_at FROM videos WHERE dm_account_id IN (3, 4, 5, 6) OR upload_status = 'failed' ORDER BY updated_at DESC LIMIT 20");
  console.log('Videos with accounts 3,4,5,6 or failed:', vids);

  const errors = await dbAll("SELECT id, title_id, tmdb_id, upload_status, error_message, updated_at FROM videos WHERE error_message IS NOT NULL ORDER BY updated_at DESC LIMIT 20");
  console.log('Recent errors:', errors);

  closeDb();
}

main().catch(console.error);
