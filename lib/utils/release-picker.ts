/**
 * Release picker — selects the best release to upload.
 *
 * Strategy:
 *   1. Prefer 1080p → 720p → 480p → 2160p (4K usually too large for DM free)
 *   2. Within same resolution, sort by file size ASCENDING (smallest first)
 *   3. Returns an ordered list: first = best choice, rest = fallbacks
 */

import type { StreamRelease } from '../scraper/types';

/** Resolution priority — lower index = higher priority */
const RESOLUTION_PRIORITY = ['1080p', '720p', '480p', '2160p'];

/** DM free account limit: 4 GB per file */
const MAX_FILE_SIZE_MB = 4096;

/** DM free account limit: 2 hours per file */
const MAX_DURATION_HOURS = 2;

export function selectBestReleases(releases: StreamRelease[]): StreamRelease[] {
  // Group by resolution
  const byRes = new Map<string, StreamRelease[]>();
  for (const r of releases) {
    const group = byRes.get(r.resolution) || [];
    group.push(r);
    byRes.set(r.resolution, group);
  }

  // Build ordered list: resolution priority × file size ascending
  const ordered: StreamRelease[] = [];
  for (const res of RESOLUTION_PRIORITY) {
    const group = byRes.get(res);
    if (group) {
      // Sort by file size ascending (smallest first), unknown sizes last
      group.sort((a, b) => {
        const aSize = a.sizeMb ?? Infinity;
        const bSize = b.sizeMb ?? Infinity;
        return aSize - bSize;
      });

      // Filter out files exceeding DM limits
      for (const release of group) {
        if (release.sizeMb && release.sizeMb > MAX_FILE_SIZE_MB) {
          continue; // Skip files > 4 GB
        }
        ordered.push(release);
      }
    }
  }

  // Add any resolutions not in our priority list (catch-all)
  for (const [res, group] of byRes) {
    if (!RESOLUTION_PRIORITY.includes(res)) {
      group.sort((a, b) => (a.sizeMb ?? Infinity) - (b.sizeMb ?? Infinity));
      for (const release of group) {
        if (release.sizeMb && release.sizeMb > MAX_FILE_SIZE_MB) continue;
        if (!ordered.includes(release)) ordered.push(release);
      }
    }
  }

  return ordered;
}

/**
 * Format summary for logging.
 */
export function releasesSummary(releases: StreamRelease[]): string {
  return releases
    .map((r, i) => {
      const size = r.sizeMb ? `${r.sizeMb.toFixed(0)} MB` : 'unknown size';
      return `  ${i + 1}. ${r.resolution} | ${size} | ${r.releaseTitle.slice(0, 60)}`;
    })
    .join('\n');
}
