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

async function run() {
  console.log('🧪 Running Swarm CI Validation Suite...\n');

  // 1. Test Title Formatting
  console.log('1. Testing DM Title Formatter:');
  const seriesTitle = formatDmTitle(314939, false, 1, 5);
  assert(seriesTitle === '314939-1-5', `Series title format expected "314939-1-5", got "${seriesTitle}"`);

  const movieTitle = formatDmTitle(1054867, true);
  assert(movieTitle === '1054867', `Movie title format expected "1054867", got "${movieTitle}"`);

  const parsedSeries = parseDmTitle('314939-1-5');
  assert(
    Boolean(parsedSeries && parsedSeries.tmdbId === 314939 && parsedSeries.season === 1 && parsedSeries.episode === 5),
    'Parse series DM title'
  );

  const parsedMovie = parseDmTitle('m-1054867');
  assert(
    Boolean(parsedMovie && parsedMovie.tmdbId === 1054867 && parsedMovie.isMovie === true),
    'Parse movie DM title'
  );

  // 2. Test Release Picker Strategy (1080p -> Smallest first -> Filter >3.8GB)
  console.log('\n2. Testing Release Picker Strategy:');
  const mockReleases: StreamRelease[] = [
    { id: '1', releaseTitle: 'Rel 4K Heavy', mirrors: ['http://a'], resolution: '2160p', sizeMb: 5000, source: 'Hub', mediaTags: [], audioLanguages: [] },
    { id: '2', releaseTitle: 'Rel 1080p Large', mirrors: ['http://b'], resolution: '1080p', sizeMb: 2400, source: 'Hub', mediaTags: [], audioLanguages: [] },
    { id: '3', releaseTitle: 'Rel 1080p Optimal', mirrors: ['http://c'], resolution: '1080p', sizeMb: 1200, source: 'Hub', mediaTags: [], audioLanguages: [] },
    { id: '4', releaseTitle: 'Rel 720p Small', mirrors: ['http://d'], resolution: '720p', sizeMb: 600, source: 'Hub', mediaTags: [], audioLanguages: [] },
  ];

  const best = selectBestReleases(mockReleases);
  assert(best.length === 3, `Expected 3 valid releases (filtered 5GB), got ${best.length}`);
  assert(Boolean(best[0] && best[0].releaseTitle === 'Rel 1080p Optimal'), 'Prioritizes 1080p smallest size first');
  assert(Boolean(best[1] && best[1].releaseTitle === 'Rel 1080p Large'), 'Follows with 1080p larger fallback');
  assert(Boolean(best[2] && best[2].releaseTitle === 'Rel 720p Small'), 'Follows with 720p fallback');

  // Test exclusion & alternative fallback
  const fallbackBest = selectBestReleases(mockReleases, {
    excludeSizesMb: [1200], // Exclude the 1200MB one that was flagged
  });
  assert(Boolean(fallbackBest[0] && fallbackBest[0].releaseTitle === 'Rel 1080p Large'), 'Fallback excludes flagged release size and picks next alternative');

  const codecReleases: StreamRelease[] = [
    { id: '1', releaseTitle: 'Show.S01E01.1080p.DSNP.H.265.mkv', mirrors: ['http://1'], resolution: '1080p', sizeMb: 1500, source: 'Hub', mediaTags: [], audioLanguages: [] },
    { id: '2', releaseTitle: 'Show.S01E01.1080p.HULU.H.264.mkv', mirrors: ['http://2'], resolution: '1080p', sizeMb: 1800, source: 'Hub', mediaTags: [], audioLanguages: [] },
  ];
  const codecBest = selectBestReleases(codecReleases, {
    excludeSizesMb: [1500],
    preferAlternativeCodec: true,
    preferAlternativeSource: true,
  });
  assert(Boolean(codecBest[0] && codecBest[0].releaseTitle.includes('HULU.H.264')), 'Alternative codec and source selection picks HULU H.264 over DSNP H.265');

  // 3. Test Auth Security
  console.log('\n3. Testing Auth Security:');
  const prevEnv = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = 'SuperSecret123!';

  assert(verifyAdminSecret('SuperSecret123!'), 'Verify correct admin secret');
  assert(!verifyAdminSecret('WrongSecret'), 'Reject incorrect admin secret');
  assert(!verifyAdminSecret(''), 'Reject empty admin secret');

  process.env.ADMIN_SECRET = prevEnv;

  // 4. Test Takedown Detection on Suspended ID
  console.log('\n4. Testing Dailymotion Health Check & Takedown Detection:');
  const { checkDmVideoHealth } = await import('../lib/dailymotion/health');

  // Video xbiami6 is known suspended
  const suspendedCheck = await checkDmVideoHealth('xbiami6');
  assert(suspendedCheck.alive === false, `Suspended video detected as dead: ${suspendedCheck.reason}`);
  assert(suspendedCheck.statusCode === 404, 'Suspended video returns HTTP 404 status');

  console.log(`\n========================================`);
  console.log(`Summary: ${passed} passed, ${failed} failed.`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run();

export {};
