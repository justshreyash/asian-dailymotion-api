/**
 * HubCloud and mirror link resolution — port of fourkhdhub/hubcloud.rs
 *
 * Resolves GreenMotors → HubDrive → HubCloud → direct video URLs.
 */

import * as cheerio from 'cheerio';

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

export async function resolveMirrorUrl(mirrorUrl: string): Promise<string> {
  if (mirrorUrl.includes('greenmotors.') || mirrorUrl.includes('greenmountmotors.')) {
    return resolveGreenMotors(mirrorUrl);
  } else if (mirrorUrl.includes('hubdrive.')) {
    return resolveHubDrive(mirrorUrl);
  } else if (mirrorUrl.includes('hubcloud.')) {
    return resolveHubCloud(mirrorUrl);
  }
  return validatePlaybackUrl(mirrorUrl);
}

// ---------------------------------------------------------------------------
// GreenMotors resolver
// ---------------------------------------------------------------------------

async function resolveGreenMotors(driveUrl: string): Promise<string> {
  const resp = await fetchWithUA(driveUrl);
  const html = await resp.text();

  const targetUrl = unpackGreenMotorsUrl(html);
  if (!targetUrl) throw new Error('Failed to unpack GreenMotors payload');

  if (targetUrl.includes('hubcloud.')) {
    return resolveHubCloud(targetUrl);
  } else if (targetUrl.includes('hubdrive.')) {
    return resolveHubDrive(targetUrl);
  }
  return validatePlaybackUrl(targetUrl);
}

// ---------------------------------------------------------------------------
// HubDrive resolver
// ---------------------------------------------------------------------------

async function resolveHubDrive(driveUrl: string): Promise<string> {
  const resp = await fetchWithUA(driveUrl);
  const html = await resp.text();

  const hubcloudUrl = extractHubCloudDriveUrl(html);
  if (!hubcloudUrl) throw new Error('HubDrive HubCloud mirror missing');

  return resolveHubCloud(hubcloudUrl);
}

// ---------------------------------------------------------------------------
// HubCloud resolver — the core resolution chain
// ---------------------------------------------------------------------------

async function resolveHubCloud(driveUrl: string): Promise<string> {
  const driveResp = await fetchWithUA(driveUrl);
  const driveHtml = await driveResp.text();

  // Find the download button link
  const resolverUrl = extractDownloadLink(driveHtml);
  if (!resolverUrl) throw new Error('HubCloud resolver link missing');

  const resolverResp = await fetchWithUA(resolverUrl);
  const resolverHtml = await resolverResp.text();

  // Collect all candidate URLs with scores
  const candidates: [number, string][] = [];

  // 1. Script pixeldrain URLs
  for (const url of extractScriptPixeldrainUrls(resolverHtml)) {
    candidates.push([score(url, 'PixelDrain'), url]);
  }

  // 2. Links in resolver page
  const $ = cheerio.load(resolverHtml);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const label = $(el).text().trim();

    // Unwrap watch-online redirects
    const unwrapped = unwrapWatchOnlineUrl(href);
    if (unwrapped) {
      try {
        const valid = validatePlaybackUrl(unwrapped);
        candidates.push([score(valid, 'Watch Online'), valid]);
        return;
      } catch { /* skip */ }
    }

    try {
      const valid = validatePlaybackUrl(href);
      const finalUrl = pixeldrainApiUrl(valid) || valid;
      candidates.push([score(finalUrl, label), finalUrl]);
    } catch { /* skip */ }
  });

  // Sort by score ascending (lower = better)
  candidates.sort((a, b) => a[0] - b[0]);

  // Try candidates in priority order
  for (const [, rawCandidate] of candidates) {
    const candidateUrl = unwrapDirectUrl(rawCandidate);
    if (candidateUrl.includes('pixel.hubcloud.') || candidateUrl.includes('workers.dev')) {
      try {
        const resolved = await followRedirectToFinal(candidateUrl);
        return unwrapDirectUrl(resolved);
      } catch {
        continue;
      }
    }
    return candidateUrl;
  }

  throw new Error('No playable stream mirrors found in HubCloud');
}

// ---------------------------------------------------------------------------
// Redirect follower
// ---------------------------------------------------------------------------

function unwrapDirectUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const link = parsed.searchParams.get('link') || parsed.searchParams.get('url');
    if (link && (link.startsWith('http://') || link.startsWith('https://'))) {
      return link;
    }
    if (rawUrl.includes('link=')) {
      const idx = rawUrl.indexOf('link=');
      const sub = decodeURIComponent(rawUrl.slice(idx + 5));
      if (sub.startsWith('http')) return sub;
    }
  } catch {}
  return rawUrl;
}

async function followRedirectToFinal(url: string): Promise<string> {
  let current = unwrapDirectUrl(url);
  for (let i = 0; i < 5; i++) {
    const resp = await fetch(current, {
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'manual',
    });

    const loc = resp.headers.get('location');
    if (loc) {
      current = unwrapDirectUrl(loc);
      if (
        current.includes('googleusercontent.com') ||
        current.endsWith('.mkv') ||
        current.endsWith('.mp4')
      ) {
        return current;
      }
    } else {
      return unwrapDirectUrl(resp.url || current);
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// GreenMotors payload decoder — same algorithm as Rust
// ---------------------------------------------------------------------------

function unpackGreenMotorsUrl(html: string): string | null {
  const payload = extractGreenMotorsPayload(html);
  if (!payload) return null;
  return decodeGreenMotorsPayload(payload);
}

function extractGreenMotorsPayload(html: string): string | null {
  const needle = 's(';
  let searchIdx = 0;

  while (true) {
    const pos = html.indexOf(needle, searchIdx);
    if (pos === -1) break;

    const absPos = pos + needle.length;
    let rest = html.slice(absPos).trimStart();

    // Check for 'o' or "o" key
    let afterKey: string | null = null;
    if (rest.startsWith("'o'")) afterKey = rest.slice(3);
    else if (rest.startsWith('"o"')) afterKey = rest.slice(3);
    else { searchIdx = absPos; continue; }

    const afterComma = afterKey.trimStart();
    if (!afterComma.startsWith(',')) { searchIdx = absPos; continue; }

    const trimmed = afterComma.slice(1).trimStart();
    const quote = trimmed[0];
    if (quote !== "'" && quote !== '"') { searchIdx = absPos; continue; }

    const payloadSlice = trimmed.slice(1);
    const end = payloadSlice.indexOf(quote);
    if (end !== -1) {
      return payloadSlice.slice(0, end);
    }

    searchIdx = absPos;
  }

  return null;
}

export function decodeGreenMotorsPayload(payload: string): string | null {
  try {
    // step1: base64 decode
    const step1 = Buffer.from(payload, 'base64').toString('utf-8');
    // step2: base64 decode again
    const step2 = Buffer.from(step1, 'base64').toString('utf-8');
    // step3: ROT13
    const step3 = rot13(step2);
    // step4: base64 decode
    const step4 = Buffer.from(step3, 'base64').toString('utf-8');
    // step5: parse JSON, get "o" field, base64 decode
    const json = JSON.parse(step4);
    const targetB64 = json.o;
    if (!targetB64) return null;
    return Buffer.from(targetB64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function rot13(input: string): string {
  return input.replace(/[a-zA-Z]/g, (c) => {
    const code = c.charCodeAt(0);
    const base = code >= 97 ? 97 : 65; // 'a' or 'A'
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

// ---------------------------------------------------------------------------
// Link extraction helpers
// ---------------------------------------------------------------------------

function extractDownloadLink(html: string): string | null {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const selectors = [
    'a#download',
    'a.btn-primary',
    'a.btn-success',
    'a.btn[href*="/download/"]',
    'a[href*="/download/"]',
    "a[href*='gamerxyt.com']",
    "a[href*='hubcloud.php']",
  ];

  for (const sel of selectors) {
    const href = $(sel).attr('href');
    if (href && href.startsWith('https://')) return href;
  }
  return null;
}

function extractHubCloudDriveUrl(html: string): string | null {
  const $ = cheerio.load(html);

  let result: string | null = null;
  $('a[href]').each((_, el) => {
    if (result) return;
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href);
      if (url.hostname.includes('hubcloud.') && url.pathname.startsWith('/drive/')) {
        result = href;
      }
    } catch { /* skip */ }
  });
  return result;
}

function unwrapWatchOnlineUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.hostname.includes('pages.dev')) {
      const b64 = url.searchParams.get('u');
      if (b64) {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.startsWith('https://')) return decoded;
      }
    }
  } catch { /* skip */ }
  return null;
}

function extractScriptPixeldrainUrls(html: string): string[] {
  const urls: string[] = [];
  const prefixes = [
    'https://pixeldrain.dev/u/',
    'https://pixeldrain.com/u/',
    'https://pixeldrain.dev/api/file/',
    'https://pixeldrain.com/api/file/',
  ];

  for (const prefix of prefixes) {
    let remainder = html;
    while (true) {
      const pos = remainder.indexOf(prefix);
      if (pos === -1) break;

      const candidate = remainder.slice(pos);
      const end = candidate.search(/["'\s<\\]/);
      const urlStr = end === -1 ? candidate : candidate.slice(0, end);

      const apiUrl = pixeldrainApiUrl(urlStr);
      if (apiUrl && !urls.includes(apiUrl)) {
        urls.push(apiUrl);
      }

      remainder = candidate.slice(end === -1 ? candidate.length : end);
    }
  }

  return urls;
}

function pixeldrainApiUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!url.hostname.includes('pixeldrain.')) return null;

    let id: string | null = null;
    if (url.pathname.startsWith('/u/')) {
      id = url.pathname.slice(3).replace(/\/$/, '');
    } else if (url.pathname.startsWith('/api/file/')) {
      id = url.pathname.slice(10).replace(/\/$/, '');
    }

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
    return `https://${url.hostname}/api/file/${id}?download`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL validation — ported from hubcloud.rs
// ---------------------------------------------------------------------------

function validatePlaybackUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error('Non-https playback URL');
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    path.endsWith('.zip') ||
    path.includes('login.php') ||
    path.includes('logout') ||
    host.includes('greenmotors.') ||
    host.includes('greenmountmotors.')
  ) {
    throw new Error(`Forbidden playback host/path: ${raw}`);
  }

  return url.toString();
}

// ---------------------------------------------------------------------------
// Scoring — ported from hubcloud.rs
// ---------------------------------------------------------------------------

function score(url: string, label: string): number {
  const value = `${url} ${label}`.toLowerCase();

  if (
    value.includes('pixel.hubcloud.') ||
    value.includes('googleusercontent.com') ||
    value.includes('googlevideo.com') ||
    value.includes('cloudflarestorage.com') ||
    value.includes('r2.cloudflarestorage.com') ||
    value.includes('fsl server') ||
    value.includes('r2.dev') ||
    value.includes('watch online')
  ) {
    return 0;
  }
  if (
    value.includes('storage.googleapis.com') ||
    value.includes('hubcloud.cx/re/') ||
    value.includes('hubcloud.fans/re/')
  ) {
    return 1;
  }
  if (value.includes('pixeldrain')) {
    return 2;
  }
  if (
    value.includes('testzip.php') ||
    value.includes('vcloud.php') ||
    value.includes('drive.php') ||
    value.includes('gpdl.')
  ) {
    return 3;
  }
  return 4;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchWithUA(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...opts,
    headers: {
      'User-Agent': BROWSER_UA,
      ...(opts?.headers || {}),
    },
  });
}
