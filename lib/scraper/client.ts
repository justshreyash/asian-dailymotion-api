/**
 * HTTP client for 4KHDHub — port of fourkhdhub/client.rs
 */

import https from 'node:https';
import { parseSearch, parseDetails, parseReleases, parseAllReleases, extractPageAudioLanguages } from './parser';
import { resolveMirrorUrl } from './hubcloud';
import type { SearchResult, StreamRelease, StreamInfo } from './types';

const DEFAULT_BASE_URL = 'https://4khdhub.one/';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpsGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await httpsGetText(url);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 600));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

export class FourKHdHubClient {
  private baseUrl: string;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(query: string): Promise<SearchResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('s', query);
    const html = await this.fetchText(url.toString());
    return parseSearch(this.baseUrl, html);
  }

  // -------------------------------------------------------------------------
  // Details
  // -------------------------------------------------------------------------

  async details(id: string): Promise<SearchResult> {
    const url = this.providerUrl(id);
    const html = await this.fetchText(url);
    return parseDetails(id, html);
  }

  // -------------------------------------------------------------------------
  // Episode releases
  // -------------------------------------------------------------------------

  async episodeReleases(id: string, season: number, episode: number): Promise<StreamRelease[]> {
    const url = this.providerUrl(id);
    const html = await this.fetchText(url);
    return parseReleases(html, season, episode);
  }

  // -------------------------------------------------------------------------
  // All releases on a page (no S/E filtering)
  // -------------------------------------------------------------------------

  async allReleases(id: string): Promise<StreamRelease[]> {
    const url = this.providerUrl(id);
    const html = await this.fetchText(url);
    return parseAllReleases(html);
  }

  // -------------------------------------------------------------------------
  // Page audio languages
  // -------------------------------------------------------------------------

  async pageAudioLanguages(id: string): Promise<string[]> {
    const url = this.providerUrl(id);
    const html = await this.fetchText(url);
    return extractPageAudioLanguages(html);
  }

  // -------------------------------------------------------------------------
  // Resolve a release to a direct stream URL
  // -------------------------------------------------------------------------

  async resolveRelease(release: StreamRelease): Promise<StreamInfo> {
    if (release.mirrors.length === 0) {
      throw new Error('No mirror links found in release');
    }

    let lastErr: Error | null = null;
    for (const mirror of release.mirrors) {
      try {
        const streamUrl = await resolveMirrorUrl(mirror);
        return {
          url: streamUrl,
          quality: release.resolution,
          headers: undefined,
          subtitles: [],
          audioLanguage: undefined,
        };
      } catch (e) {
        lastErr = e as Error;
      }
    }

    throw lastErr || new Error('Failed to resolve any stream mirror');
  }

  // -------------------------------------------------------------------------
  // Category listing (Korean drama pages)
  // -------------------------------------------------------------------------

  async listCategory(category: string, page = 1): Promise<SearchResult[]> {
    const url = `${this.baseUrl}category/${category}/page/${page}/`;
    const html = await this.fetchText(url);
    return parseSearch(this.baseUrl, html);
  }

  /**
   * List ALL pages of a category by paginating until empty results.
   */
  async listAllCategory(category: string): Promise<SearchResult[]> {
    const all: SearchResult[] = [];
    let page = 1;

    while (true) {
      console.log(`  Fetching category "${category}" page ${page}...`);
      try {
        const results = await this.listCategory(category, page);
        if (results.length === 0) break;
        all.push(...results);
        page++;
        // Rate limit: wait 1.5s between pages
        await sleep(1500);
      } catch (e) {
        console.log(`  Page ${page} failed, stopping pagination:`, (e as Error).message);
        break;
      }
    }

    return all;
  }

  // -------------------------------------------------------------------------
  // Raw HTML fetch (for detail pages where we need both details + releases)
  // -------------------------------------------------------------------------

  async fetchRawHtml(id: string): Promise<string> {
    const url = this.providerUrl(id);
    return this.fetchText(url);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private providerUrl(id: string): string {
    const path = id.startsWith('/') ? id : `/${id}`;
    return new URL(path, this.baseUrl).toString();
  }

  private async fetchText(url: string): Promise<string> {
    return fetchWithRetry(url);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
