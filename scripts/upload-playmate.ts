/**
 * Run Playmate Video Fallback Pipeline
 * Usage:
 *   npx tsx scripts/upload-playmate.ts --limit 1     # Test with 1 video
 *   npx tsx scripts/upload-playmate.ts --all         # Upload all blacklisted/error videos
 *   npx tsx scripts/upload-playmate.ts --video 82    # Upload specific video by DB ID
 */

import 'dotenv/config';
import { uploadEligibleToPlaymate } from '../lib/pipeline/playmate-upload';
import { closeDb } from '../lib/db/client';

async function main() {
  const args = process.argv.slice(2);
  let limit: number | undefined;
  let videoIds: number[] | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--video' && args[i + 1]) {
      videoIds = [parseInt(args[i + 1], 10)];
      i++;
    } else if (args[i] === '--test') {
      limit = 1;
    }
  }

  // Default to limit 1 if not specified as --all
  if (!args.includes('--all') && !limit && !videoIds) {
    console.log('💡 No flags specified. Running in single-item test mode (--limit 1).');
    console.log('   Pass --all to upload all eligible videos or --video <id> for specific video.\n');
    limit = 1;
  }

  const result = await uploadEligibleToPlaymate({
    limit,
    videoIds,
  });

  await closeDb();
  console.log('Result:', result);
}

main().catch(err => {
  console.error('Playmate pipeline failed:', err);
  closeDb();
  process.exit(1);
});
