import 'dotenv/config';
import { getTitleByTmdbId, blacklistTitle, getAllTitles } from '../lib/db/queries';
import { closeDb } from '../lib/db/client';

async function main() {
  const titles = await getAllTitles();
  const korea = titles.find(t => t.tmdb_id === 246473 || t.title.toLowerCase().includes('made in korea'));
  
  if (!korea) {
    console.log('Title "Made in Korea" (TMDB 246473) not found in catalog.');
    closeDb();
    return;
  }

  console.log(`Found title: "${korea.title}" (ID: ${korea.id}, TMDB: ${korea.tmdb_id}, Current Status: ${korea.status})`);
  await blacklistTitle(korea.id);

  const updated = await getTitleByTmdbId(246473);
  console.log(`✅ Updated status: "${updated?.title}" is now status="${updated?.status}".`);

  closeDb();
}

main().catch(console.error);
