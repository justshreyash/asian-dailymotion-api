/**
 * CI automated validation suite.
 * Runs in GitHub Actions before build to verify core logic integrity.
 */

import { formatDmTitle, parseDmTitle } from '../lib/utils/title-format';
import { selectBestReleases } from '../lib/utils/release-picker';
import { verifyAdminSecret } from '../lib/auth';
import type { StreamRelease } from '../lib/scraper/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

console.log('🧪 Running Swarm CI Validation Suite...\n');

// 1. Test Title Formatting
console.log('1. Testing DM Title Formatter:');
const seriesTitle = formatDmTitle(314939, false, 1, 5);
assert(seriesTitle === '314939-1-5', `Series title format expected "314939-1-5", got "${seriesTitle}"`);

const movieTitle = formatDmTitle(1054867, true);
assert(movieTitle === '1054867', `Movie title format expected "1054867", got "${movieTitle}"`);

const parsedSeries = parseDmTitle('314939-1-5');
assert(parsedSeries.tmdbId === 314939 && parsedSeries.season === 1 && parsedSeries.episode === 5, 'Parse series DM title');

const parsedMovie = parseDmTitle('m-1054867');
assert(parsedMovie.tmdbId === 1054867 && parsedMovie.isMovie === true, 'Parse movie DM title');

// 2. Test Release Picker Strategy (1080p -> Smallest first -> Filter >3.8GB)
console.log('\n2. Testing Release Picker Strategy:');
const mockReleases: StreamRelease[] = [
  { releaseTitle: 'Rel 4K Heavy', directUrl: 'http://a', resolution: '2160p', sizeMb: 5000 },
  { releaseTitle: 'Rel 1080p Large', directUrl: 'http://b', resolution: '1080p', sizeMb: 2400 },
  { releaseTitle: 'Rel 1080p Optimal', directUrl: 'http://c', resolution: '1080p', sizeMb: 1200 },
  { releaseTitle: 'Rel 720p Small', directUrl: 'http://d', resolution: '720p', sizeMb: 600 },
];

const best = selectBestReleases(mockReleases);
assert(best.length === 3, `Expected 3 valid releases (filtered 5GB), got ${best.length}`);
assert(best[0].releaseTitle === 'Rel 1080p Optimal', 'Prioritizes 1080p smallest size first');
assert(best[1].releaseTitle === 'Rel 1080p Large', 'Follows with 1080p larger fallback');
assert(best[2].releaseTitle === 'Rel 720p Small', 'Follows with 720p fallback');

// 3. Test Auth Security
console.log('\n3. Testing Auth Security:');
const prevEnv = process.env.ADMIN_SECRET;
process.env.ADMIN_SECRET = 'SuperSecret123!';

assert(verifyAdminSecret('SuperSecret123!'), 'Verify correct admin secret');
assert(!verifyAdminSecret('WrongSecret'), 'Reject incorrect admin secret');
assert(!verifyAdminSecret(''), 'Reject empty admin secret');

process.env.ADMIN_SECRET = prevEnv;

console.log(`\n========================================`);
console.log(`Summary: ${passed} passed, ${failed} failed.`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
