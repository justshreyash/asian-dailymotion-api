/**
 * HTML parser for 4KHDHub — port of fourkhdhub/parser.rs
 *
 * Handles: search results, detail pages, episode releases, season/episode extraction.
 */

import * as cheerio from 'cheerio';
import type { SearchResult, Season, Episode, StreamRelease, MediaKind } from './types';

// ---------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------

export function parseSearch(baseUrl: string, html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const items: SearchResult[] = [];

  $('a.movie-card').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.hostname !== base.hostname) return;

    const itemTitle = $(el).find('.movie-card-title').text().trim();
    if (!itemTitle) return;

    const metaText = $(el).find('.movie-card-meta').text().trim();
    const year = firstFourDigitYear(metaText);
    const kind: MediaKind = href.includes('-series-') ? 'series' : 'movie';
    const posterUrl = $(el).find('img').attr('src') || undefined;

    items.push({
      id: url.pathname.replace(/^\//, ''),
      title: itemTitle,
      year,
      kind,
      providerId: 'fourkhdhub',
      overview: undefined,
      posterUrl,
      seasons: undefined,
    });
  });

  return items;
}

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

export function parseDetails(id: string, html: string): SearchResult {
  const $ = cheerio.load(html);

  const rawTitle =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    '';

  if (!rawTitle) throw new Error('Title missing in 4KHDHub details');

  const title = stripTrailingYear(rawTitle);
  const kind: MediaKind = id.includes('-series-') ? 'series' : 'movie';
  const overview =
    $('.content-section p.mt-4').first().text().trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    undefined;
  const posterUrl = $('meta[property="og:image"]').attr('content') || undefined;
  const year = firstFourDigitYear(rawTitle);
  const seasons = parseSeasons($);

  return {
    id,
    title,
    year,
    kind,
    providerId: 'fourkhdhub',
    overview,
    posterUrl,
    seasons: seasons.length > 0 ? seasons : undefined,
  };
}

// ---------------------------------------------------------------------------
// Episode releases
// ---------------------------------------------------------------------------

export function parseReleases(html: string, season: number, episode: number): StreamRelease[] {
  const $ = cheerio.load(html);
  const hasEpisodeItems = $('#episodes .episode-download-item').length > 0;
  const isEpisodeQuery = season > 0 && hasEpisodeItems;

  const itemSelector = isEpisodeQuery
    ? '#episodes .episode-download-item'
    : '.download-item';
  const filenameSelector = isEpisodeQuery
    ? '.episode-file-title'
    : '.file-title';

  const grouped = new Map<string, StreamRelease>();

  $(itemSelector).each((_, el) => {
    const $item = $(el);
    const filename = $item.find(filenameSelector).text().trim();
    if (!filename || isArchive(filename)) return;

    if (isEpisodeQuery) {
      const parsed = parseSeasonEpisode(filename);
      if (!parsed || parsed[0] !== season || parsed[1] !== episode) return;
    }

    const mirrors: string[] = [];
    let sourceLabel = 'Download HubCloud';

    $item.find('a[href]').each((_, linkEl) => {
      const href = $(linkEl).attr('href');
      if (!href || !href.startsWith('https://') || href.includes('logout')) return;
      const label = $(linkEl).text().trim();
      if (label && label !== 'Direct') sourceLabel = label;
      mirrors.push(href);
    });

    if (mirrors.length === 0) return;

    // Parse file size from badges
    const sizeText = extractSizeText($item);
    const sizeMb = parseSizeToMb(sizeText);

    // Parse audio languages from badges/code spans
    const audioLanguages = extractAudioLanguages($item);

    const resolution = detectResolution(filename);
    const mediaTags = detectMediaTags(filename);

    const key = filename;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: filename,
        resolution,
        size: sizeText,
        sizeMb,
        mediaTags,
        source: sourceLabel,
        releaseTitle: filename,
        mirrors: [],
        audioLanguages,
      });
    }

    const release = grouped.get(key)!;
    for (const mirror of mirrors) {
      if (!release.mirrors.includes(mirror)) {
        release.mirrors.push(mirror);
      }
    }
  });

  const releases = Array.from(grouped.values());

  // Sort by resolution descending (2160p > 1080p > 720p > 480p)
  releases.sort((a, b) => resOrder(b.resolution) - resOrder(a.resolution));

  return releases;
}

// ---------------------------------------------------------------------------
// Parse all releases on a page (no season/episode filtering)
// ---------------------------------------------------------------------------

export function parseAllReleases(html: string): StreamRelease[] {
  const $ = cheerio.load(html);
  const releases: StreamRelease[] = [];

  // Try both download-item selectors
  const selectors = ['.download-item', '#episodes .episode-download-item'];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const $item = $(el);
      const filenameSelector = selector.includes('episode') ? '.episode-file-title' : '.file-title';
      const filename = $item.find(filenameSelector).text().trim();
      if (!filename || isArchive(filename)) return;

      const mirrors: string[] = [];
      let sourceLabel = 'Download HubCloud';

      $item.find('a[href]').each((_, linkEl) => {
        const href = $(linkEl).attr('href');
        if (!href || !href.startsWith('https://') || href.includes('logout')) return;
        const label = $(linkEl).text().trim();
        if (label && label !== 'Direct') sourceLabel = label;
        mirrors.push(href);
      });

      if (mirrors.length === 0) return;

      const sizeText = extractSizeText($item);
      const sizeMb = parseSizeToMb(sizeText);
      const audioLanguages = extractAudioLanguages($item);
      const resolution = detectResolution(filename);
      const mediaTags = detectMediaTags(filename);

      releases.push({
        id: filename,
        resolution,
        size: sizeText,
        sizeMb,
        mediaTags,
        source: sourceLabel,
        releaseTitle: filename,
        mirrors,
        audioLanguages,
      });
    });
  }

  return releases;
}

// ---------------------------------------------------------------------------
// Audio language extraction
// ---------------------------------------------------------------------------

export function extractAudioLanguages($item: cheerio.Cheerio<any>): string[] {
  const langs: string[] = [];

  // Method 1: Look for language info in code > span elements
  $item.find('code span').each((_, span) => {
    const text = cheerio.load(span).root().text().trim();
    // Language spans typically contain comma-separated language names
    if (text.match(/\b(hindi|english|korean|japanese|tamil|telugu|original|multi|dual)\b/i)) {
      const parts = text.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.match(/^(hindi|english|korean|japanese|tamil|telugu|original|multi|dual)$/i)) {
          langs.push(part.toLowerCase());
        }
      }
    }
  });

  // Method 2: Look for language badges
  $item.find('.badge, .badge-lang, .badge-audio').each((_, badge) => {
    const text = cheerio.load(badge).root().text().trim().toLowerCase();
    if (text.match(/\b(hindi|english|korean|japanese|tamil|telugu|original|multi|dual)\b/)) {
      langs.push(text);
    }
  });

  // Method 3: Check filename for "Multi" or language hints
  const filename = $item.find('.file-title, .episode-file-title').text().trim();
  if (filename) {
    const upper = filename.toUpperCase();
    if (upper.includes('.MULTI.') || upper.includes('-MULTI-') || upper.includes(' MULTI ')) {
      if (!langs.includes('multi')) langs.push('multi');
    }
    if (upper.includes('HINDI')) {
      if (!langs.includes('hindi')) langs.push('hindi');
    }
    if (upper.includes('KOREAN')) {
      if (!langs.includes('korean')) langs.push('korean');
    }
    if (upper.includes('ENGLISH') || upper.includes('ENG')) {
      if (!langs.includes('english')) langs.push('english');
    }
  }

  return [...new Set(langs)];
}

/**
 * Extract audio languages from the full detail page (not per-release).
 * Looks at page-level metadata, headings, and content sections.
 */
export function extractPageAudioLanguages(html: string): string[] {
  const $ = cheerio.load(html);
  const langs: string[] = [];

  // Check title/heading for language clues
  const h1 = $('h1').text().trim().toLowerCase();
  const pageText = $('body').text().toLowerCase();

  // Look for audio info in content sections
  const knownLangs = ['hindi', 'english', 'korean', 'japanese', 'tamil', 'telugu', 'original'];
  for (const lang of knownLangs) {
    // Check in common patterns like "Audio: Hindi, Korean, English"
    if (pageText.includes(`audio`) && pageText.includes(lang)) {
      langs.push(lang);
    }
  }

  // Check for language info in all badges and meta spans
  $('span, .badge, code span').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    for (const lang of knownLangs) {
      if (text.includes(lang) && !langs.includes(lang)) {
        langs.push(lang);
      }
    }
  });

  // Also check Multi in filename/title hints
  if (h1.includes('multi') || pageText.includes('multi audio')) {
    if (!langs.includes('multi')) langs.push('multi');
  }

  return [...new Set(langs)];
}

// ---------------------------------------------------------------------------
// Parse season/episode structure
// ---------------------------------------------------------------------------

function parseSeasons($: cheerio.CheerioAPI): Season[] {
  const seasonsMap = new Map<number, Map<number, Episode>>();

  $('#episodes .episode-download-item').each((_, el) => {
    const filename = $(el).find('.episode-file-title').text().trim();
    const parsed = parseSeasonEpisode(filename);
    if (!parsed) return;

    const [s, e] = parsed;
    if (!seasonsMap.has(s)) seasonsMap.set(s, new Map());
    const episodes = seasonsMap.get(s)!;
    if (!episodes.has(e)) {
      episodes.set(e, {
        episodeNumber: e,
        title: `Episode ${String(e).padStart(2, '0')}`,
        id: `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`,
      });
    }
  });

  return Array.from(seasonsMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, eps]) => ({
      seasonNumber,
      episodes: Array.from(eps.values()).sort((a, b) => a.episodeNumber - b.episodeNumber),
    }));
}

// ---------------------------------------------------------------------------
// Helpers — ported from parser.rs
// ---------------------------------------------------------------------------

export function parseSeasonEpisode(text: string): [number, number] | null {
  const upper = text.toUpperCase();
  let idx = 0;

  while (idx < upper.length) {
    const sPos = upper.indexOf('S', idx);
    if (sPos === -1) break;

    const rest = upper.slice(sPos + 1);
    const sDigitsMatch = rest.match(/^(\d{1,3})/);
    if (sDigitsMatch) {
      const sVal = parseInt(sDigitsMatch[1], 10);
      const afterS = rest.slice(sDigitsMatch[1].length);

      let eStart = 0;
      if (afterS.startsWith('EP')) eStart = 2;
      else if (afterS.startsWith('E')) eStart = 1;

      if (eStart > 0) {
        const eRest = afterS.slice(eStart);
        const eDigitsMatch = eRest.match(/^(\d{1,3})/);
        if (eDigitsMatch) {
          const eVal = parseInt(eDigitsMatch[1], 10);
          return [sVal, eVal];
        }
      }
    }

    idx = sPos + 1;
  }

  return null;
}

export function detectResolution(filename: string): string {
  const upper = filename.toUpperCase();
  if (
    upper.includes('2160P') ||
    upper.includes('.4K.') ||
    upper.includes(' 4K ') ||
    upper.includes('[4K]') ||
    upper.includes('-4K-') ||
    upper.includes('_4K_')
  ) {
    return '2160p';
  }
  if (upper.includes('1080P') || upper.includes('.1080.') || upper.includes('FHD')) {
    return '1080p';
  }
  if (upper.includes('720P') || upper.includes('.720.')) {
    return '720p';
  }
  if (upper.includes('480P') || upper.includes('.480.')) {
    return '480p';
  }
  return '1080p'; // default
}

export function detectMediaTags(filename: string): string[] {
  const upper = filename.toUpperCase();
  const tags: string[] = [];

  if (upper.includes('AV1')) {
    tags.push('AV1');
  } else if (upper.includes('H.265') || upper.includes('HEVC') || upper.includes('X265')) {
    tags.push('HEVC');
  } else if (upper.includes('H.264') || upper.includes('AVC') || upper.includes('X264')) {
    tags.push('H.264');
  }

  if (upper.includes('WEB-DL') || upper.includes('WEBDL')) {
    tags.push('WEB-DL');
  } else if (upper.includes('WEBRIP')) {
    tags.push('WEBRip');
  } else if (upper.includes('BLURAY')) {
    tags.push('BluRay');
  }

  if (upper.includes('DDP') || upper.includes('EAC3')) {
    tags.push('DDP');
  }

  if (tags.length === 0) {
    tags.push('WEB-DL');
  }

  return tags;
}

function isArchive(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z');
}

function firstFourDigitYear(text: string): number | undefined {
  const match = text.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? parseInt(match[1], 10) : undefined;
}

function stripTrailingYear(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length > 6 && trimmed.endsWith(')')) {
    const openParen = trimmed.lastIndexOf('(');
    if (openParen !== -1) {
      const inside = trimmed.slice(openParen + 1, -1);
      if (inside.length === 4 && /^\d{4}$/.test(inside)) {
        return trimmed.slice(0, openParen).trim();
      }
    }
  }
  return trimmed;
}

function resOrder(res: string): number {
  if (res.includes('2160') || res.includes('4K')) return 4;
  if (res.includes('1080')) return 3;
  if (res.includes('720')) return 2;
  return 1;
}

function extractSizeText($item: cheerio.Cheerio<any>): string | undefined {
  let sizeText: string | undefined;

  $item.find('.badge-size, .badge, code span').each((_, el) => {
    if (sizeText) return;
    const text = cheerio.load(el).root().text().trim();
    if (text.match(/\d+(\.\d+)?\s*(MB|GB|mb|gb)/i)) {
      sizeText = text;
    }
  });

  return sizeText;
}

export function parseSizeToMb(sizeText?: string): number | undefined {
  if (!sizeText) return undefined;
  const match = sizeText.match(/([\d.]+)\s*(MB|GB)/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  return unit === 'GB' ? value * 1024 : value;
}
