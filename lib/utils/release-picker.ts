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

export interface ReleasePickerOptions {
  excludeUrls?: string[];
  excludeSizesMb?: number[];
  excludeKeywords?: string[];
  preferAlternativeCodec?: boolean;
  preferAlternativeSource?: boolean;
}

export function selectBestReleases(
  releases: StreamRelease[],
  options: ReleasePickerOptions = {}
): StreamRelease[] {
  const excludeUrls = new Set((options.excludeUrls || []).map(u => u.toLowerCase()));
  const excludeSizes = options.excludeSizesMb || [];
  const excludeKeywords = (options.excludeKeywords || []).map(k => k.toLowerCase());

  // Filter out invalid, oversized, unsupported codecs (AV1), or excluded releases
  const filtered = releases.filter(r => {
    if (r.sizeMb && r.sizeMb > MAX_FILE_SIZE_MB) return false;

    const lowerTitle = (r.releaseTitle || '').toLowerCase();

    // Dailymotion transcoders do NOT support raw AV1 in MKV/MP4 containers and fail with encoding_error
    if (lowerTitle.includes('av1') || lowerTitle.includes('av01') || lowerTitle.includes('.av1.')) {
      return false;
    }

    // Check size exclusion (within 10MB tolerance of a flagged release)
    if (r.sizeMb && excludeSizes.some(s => Math.abs(s - r.sizeMb!) < 10)) {
      return false;
    }

    // Check keyword exclusion in title
    if (excludeKeywords.length > 0) {
      if (excludeKeywords.some(k => lowerTitle.includes(k))) return false;
    }

    // Check URL exclusion
    if (excludeUrls.size > 0 && r.mirrors) {
      if (r.mirrors.some(m => excludeUrls.has(m.toLowerCase()))) return false;
    }

    return true;
  });

  // Group by resolution
  const byRes = new Map<string, StreamRelease[]>();
  for (const r of filtered) {
    const group = byRes.get(r.resolution) || [];
    group.push(r);
    byRes.set(r.resolution, group);
  }

  const scoreRelease = (r: StreamRelease): number => {
    let score = 0;
    const title = r.releaseTitle.toUpperCase();

    // If alternative codec preferred, boost H.264/AVC over H.265
    if (options.preferAlternativeCodec) {
      if (title.includes('H.264') || title.includes('AVC') || title.includes('X264')) {
        score += 50;
      }
    }

    // If alternative source preferred, boost HULU/AMZN over DSNP
    if (options.preferAlternativeSource) {
      if (title.includes('HULU') || title.includes('AMZN') || title.includes('NF')) {
        score += 40;
      }
    }

    return score;
  };

  // Build ordered list: resolution priority × score descending × file size ascending
  const ordered: StreamRelease[] = [];
  for (const res of RESOLUTION_PRIORITY) {
    const group = byRes.get(res);
    if (group) {
      group.sort((a, b) => {
        const scoreDiff = scoreRelease(b) - scoreRelease(a);
        if (scoreDiff !== 0) return scoreDiff;

        const aSize = a.sizeMb ?? Infinity;
        const bSize = b.sizeMb ?? Infinity;
        return aSize - bSize;
      });

      for (const release of group) {
        ordered.push(release);
      }
    }
  }

  // Add any resolutions not in our priority list (catch-all)
  for (const [res, group] of byRes) {
    if (!RESOLUTION_PRIORITY.includes(res)) {
      group.sort((a, b) => {
        const scoreDiff = scoreRelease(b) - scoreRelease(a);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.sizeMb ?? Infinity) - (b.sizeMb ?? Infinity);
      });
      for (const release of group) {
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
