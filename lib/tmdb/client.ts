/**
 * TMDB API v3 client — search and match Korean dramas/movies.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';

export interface TmdbSearchResult {
  id: number;
  name?: string; // TV series
  title?: string; // Movies
  original_language: string;
  first_air_date?: string;
  release_date?: string;
  overview: string;
  poster_path: string | null;
  vote_average: number;
  popularity: number;
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  status: string;
  in_production: boolean;
  first_air_date?: string;
  last_air_date?: string;
  number_of_seasons: number;
  number_of_episodes: number;
  poster_path?: string | null;
  last_episode_to_air?: {
    air_date?: string;
    episode_number?: number;
    season_number?: number;
    name?: string;
  } | null;
  next_episode_to_air?: {
    air_date?: string;
    episode_number?: number;
    season_number?: number;
    name?: string;
  } | null;
  seasons: {
    season_number: number;
    episode_count: number;
    air_date?: string;
  }[];
}

export interface MatchResult {
  tmdbId: number;
  year?: number;
  seasons?: number;
  episodes?: number;
  isOnAir?: boolean;
  airingStatus?: string;
  nextAirDate?: string;
  lastAirDate?: string;
  posterUrl?: string;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*-\s*UNCENSORED/gi, '')
    .replace(/\s*-\s*Adult/gi, '')
    .replace(/\s*\(Adult\)/gi, '')
    .replace(/\s*\(Uncut\)/gi, '')
    .replace(/\s*-\s*Season\s*\d+/gi, '')
    .replace(/\s*Season\s*\d+/gi, '')
    .replace(/\s*S\d+/gi, '')
    .replace(/\s*\(?\d{4}\)?/g, '')
    .trim();
}

import https from 'node:https';

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 404) {
        return resolve({ results: [] });
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await httpsGetJson(url);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 400));
    }
  }
}

export class TmdbClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.TMDB_API_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️ TMDB_API_KEY not set — TMDB features disabled');
    }
  }

  /**
   * Search for a TV series on TMDB.
   */
  async searchTv(query: string, year?: number): Promise<TmdbSearchResult[]> {
    const clean = cleanTitle(query);
    const params = new URLSearchParams({
      api_key: this.apiKey,
      query: clean || query,
      language: 'en-US',
    });
    if (year) params.set('first_air_date_year', String(year));

    const data = await fetchWithRetry(`${TMDB_BASE}/search/tv?${params}`);
    return (data.results || []) as TmdbSearchResult[];
  }

  /**
   * Search for a movie on TMDB.
   */
  async searchMovie(query: string, year?: number): Promise<TmdbSearchResult[]> {
    const clean = cleanTitle(query);
    const params = new URLSearchParams({
      api_key: this.apiKey,
      query: clean || query,
      language: 'en-US',
    });
    if (year) params.set('year', String(year));

    const data = await fetchWithRetry(`${TMDB_BASE}/search/movie?${params}`);
    return (data.results || []) as TmdbSearchResult[];
  }

  /**
   * Get TV series details (season/episode counts).
   */
  async getTvDetails(tmdbId: number): Promise<TmdbTvDetails> {
    const params = new URLSearchParams({ api_key: this.apiKey });
    return await fetchWithRetry(`${TMDB_BASE}/tv/${tmdbId}?${params}`);
  }

  /**
   * Match a title to a TMDB ID — tries to find the best match.
   * Prioritizes Korean original language results.
   */
  async matchTitle(
    title: string,
    kind: 'series' | 'movie',
    year?: number,
  ): Promise<MatchResult | null> {
    if (!this.apiKey) return null;

    try {
      const results =
        kind === 'series'
          ? await this.searchTv(title, year)
          : await this.searchMovie(title, year);

      if (!results || results.length === 0) {
        // Try without year
        const retryResults =
          kind === 'series'
            ? await this.searchTv(title)
            : await this.searchMovie(title);
        if (!retryResults || retryResults.length === 0) {
          // If kind was movie, also fallback to tv search or vice versa
          const altResults =
            kind === 'series'
              ? await this.searchMovie(title)
              : await this.searchTv(title);
          if (!altResults || altResults.length === 0) return null;
          return this.pickBestMatch(altResults, kind === 'series' ? 'movie' : 'series', title);
        }
        return this.pickBestMatch(retryResults, kind, title);
      }

      return this.pickBestMatch(results, kind, title);
    } catch (e) {
      console.log(`  TMDB match failed for "${title}": ${(e as Error).message}`);
      return null;
    }
  }

  private async pickBestMatch(
    results: TmdbSearchResult[],
    kind: 'series' | 'movie',
    originalTitle: string,
  ): Promise<MatchResult | null> {
    // Prefer Korean language results
    const korean = results.filter(r => r.original_language === 'ko');
    const best = korean.length > 0 ? korean[0] : results[0];
    if (!best) return null;

    const posterUrl = best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : undefined;
    const yearStr = best.first_air_date || best.release_date;
    const year = yearStr ? parseInt(yearStr.slice(0, 4), 10) : undefined;

    if (kind === 'series') {
      try {
        const details = await this.getTvDetails(best.id);
        const isOnAir = details.in_production || details.status === 'Returning Series';
        const tvYearStr = details.first_air_date || yearStr;
        const tvYear = tvYearStr ? parseInt(tvYearStr.slice(0, 4), 10) : year;

        return {
          tmdbId: best.id,
          year: tvYear,
          seasons: details.number_of_seasons,
          episodes: details.number_of_episodes,
          isOnAir,
          airingStatus: details.status,
          nextAirDate: details.next_episode_to_air?.air_date,
          lastAirDate: details.last_air_date || details.last_episode_to_air?.air_date,
          posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : posterUrl,
        };
      } catch {
        return { tmdbId: best.id, year, posterUrl };
      }
    }

    return { tmdbId: best.id, year, posterUrl };
  }
}
