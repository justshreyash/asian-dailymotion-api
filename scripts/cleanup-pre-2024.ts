import 'dotenv/config';
import { dbRun, dbAll, closeDb } from '../lib/db/client';

async function main() {
  console.log('🧹 Purging pre-2024 un-uploaded titles from database...');

  // Delete videos for titles that have year < 2024 and are not uploaded
  await dbRun(`
    DELETE FROM videos 
    WHERE upload_status != 'uploaded' 
      AND title_id IN (SELECT id FROM titles WHERE year < 2024)
  `);

  // Delete titles with year < 2024 that have no uploaded videos
  await dbRun(`
    DELETE FROM titles 
    WHERE year < 2024 
      AND id NOT IN (SELECT DISTINCT title_id FROM videos WHERE upload_status = 'uploaded')
  `);

  const remaining = await dbAll('SELECT id, title, kind, year, status FROM titles ORDER BY year DESC, title ASC');
  console.log(`\n✅ Database Cleaned. Total active catalog titles: ${remaining.length}`);

  const breakdown: Record<string, number> = {};
  for (const r of remaining) {
    const y = r.year ? String(r.year) : 'unknown';
    breakdown[y] = (breakdown[y] || 0) + 1;
  }
  console.log('📊 Active Catalog Breakdown by Year:', breakdown);

  const series = remaining.filter(r => r.kind === 'series');
  const movies = remaining.filter(r => r.kind === 'movie');
  console.log(`   - TV Dramas / Series (2024-2026): ${series.length}`);
  console.log(`   - Movies (2024-2026): ${movies.length}`);

  closeDb();
}

main().catch(err => {
  console.error('Error during cleanup:', err);
  closeDb();
  process.exit(1);
});
