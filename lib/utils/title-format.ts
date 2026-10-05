/**
 * Title formatting helpers for Dailymotion video titles.
 *
 * Series: "{tmdb_id}-{season}-{episode}"  e.g. "305644-1-4"
 * Movie:  "m-{tmdb_id}"                   e.g. "m-305644"
 */

export function formatDmTitle(tmdbId: number, isMovie: boolean, season?: number, episode?: number): string {
  if (isMovie) {
    return `${tmdbId}`;
  }
  return `${tmdbId}-${season}-${episode}`;
}

/**
 * Parse a DM title back to its components.
 *
 * Supports:
 * - Movie: "{tmdbId}" e.g. "961268" or "m-961268"
 * - Series: "{tmdbId}-{season}-{episode}" e.g. "305644-1-4"
 */
export function parseDmTitle(dmTitle: string): {
  tmdbId: number;
  isMovie: boolean;
  season?: number;
  episode?: number;
} | null {
  // Series match first: "{tmdbId}-{season}-{episode}" or optional prefix "0--314939-1-2"
  const seriesMatch = dmTitle.match(/(?:^|--)(\d+)-(\d+)-(\d+)$/);
  if (seriesMatch) {
    return {
      tmdbId: parseInt(seriesMatch[1], 10),
      isMovie: false,
      season: parseInt(seriesMatch[2], 10),
      episode: parseInt(seriesMatch[3], 10),
    };
  }

  // Movie match: purely numeric "{tmdbId}" or legacy "m-{tmdbId}"
  const movieMatch = dmTitle.match(/^(?:m-)?(\d+)$/);
  if (movieMatch) {
    return { tmdbId: parseInt(movieMatch[1], 10), isMovie: true };
  }

  return null;
}
