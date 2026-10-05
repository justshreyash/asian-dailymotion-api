/**
 * Database queries supporting both local SQLite and Turso Cloud DB.
 */

import { dbAll, dbGet, dbRun, dbExec } from './client';

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

export interface TitleRow {
  id: number;
  slug: string;
  title: string;
  kind: 'series' | 'movie';
  year: number | null;
  tmdb_id: number | null;
  poster_url: string | null;
  audio_langs: string;
  total_seasons: number;
  total_episodes: number;
  is_on_air: number;
  airing_status: string;
  next_air_date: string | null;
  last_air_date: string | null;
  last_scraped_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function upsertTitle(data: {
  slug: string;
  title: string;
  kind: 'series' | 'movie';
  year?: number;
  posterUrl?: string;
  audioLangs: string[];
}): Promise<TitleRow | undefined> {
  await dbRun(`
    INSERT INTO titles (slug, title, kind, year, poster_url, audio_langs)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      audio_langs = excluded.audio_langs,
      poster_url = COALESCE(excluded.poster_url, titles.poster_url),
      updated_at = datetime('now')
  `, [
    data.slug,
    data.title,
    data.kind,
    data.year ?? null,
    data.posterUrl ?? null,
    JSON.stringify(data.audioLangs),
  ]);

  return getTitleBySlug(data.slug);
}

export async function getTitleBySlug(slug: string): Promise<TitleRow | undefined> {
  return dbGet<TitleRow>('SELECT * FROM titles WHERE slug = ?', [slug]);
}

export async function getTitleByTmdbId(tmdbId: number): Promise<TitleRow | undefined> {
  return dbGet<TitleRow>('SELECT * FROM titles WHERE tmdb_id = ?', [tmdbId]);
}

export async function getTitlesWithoutTmdb(includeFailed = false): Promise<TitleRow[]> {
  if (includeFailed) {
    return dbAll<TitleRow>("SELECT * FROM titles WHERE tmdb_id IS NULL");
  }
  return dbAll<TitleRow>("SELECT * FROM titles WHERE tmdb_id IS NULL AND status != 'failed'");
}

export async function getOnAirTitles(): Promise<TitleRow[]> {
  return dbAll<TitleRow>("SELECT * FROM titles WHERE is_on_air = 1 OR airing_status = 'Returning Series' ORDER BY updated_at DESC");
}

export async function resetFailedTitles(): Promise<void> {
  await dbRun("UPDATE titles SET status = 'discovered' WHERE tmdb_id IS NULL AND status = 'failed'");
}

export async function toggleDmAccountActive(id: number, isActive: boolean): Promise<void> {
  await dbRun('UPDATE dm_accounts SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id]);
}

export async function deleteDmAccount(id: number): Promise<void> {
  await dbRun('DELETE FROM dm_accounts WHERE id = ?', [id]);
}

export async function getTitlesByStatus(status: string): Promise<TitleRow[]> {
  return dbAll<TitleRow>('SELECT * FROM titles WHERE status = ?', [status]);
}

export async function getAllTitles(options: { q?: string; status?: string; kind?: string; limit?: number } = {}): Promise<TitleRow[]> {
  let sql = 'SELECT * FROM titles WHERE 1=1';
  const params: any[] = [];

  if (options.q) {
    sql += ' AND (title LIKE ? OR slug LIKE ? OR tmdb_id LIKE ?)';
    params.push(`%${options.q}%`, `%${options.q}%`, `%${options.q}%`);
  }
  if (options.status) {
    sql += ' AND status = ?';
    params.push(options.status);
  }
  if (options.kind) {
    sql += ' AND kind = ?';
    params.push(options.kind);
  }

  const limit = options.limit || 200;
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  return dbAll<TitleRow>(sql, params);
}

export async function updateTitleTmdb(
  id: number,
  tmdbId: number,
  seasons?: number,
  episodes?: number,
  extra?: {
    year?: number;
    isOnAir?: boolean;
    airingStatus?: string;
    nextAirDate?: string;
    lastAirDate?: string;
    posterUrl?: string;
  }
): Promise<void> {
  await dbRun(`
    UPDATE titles SET
      tmdb_id = ?,
      year = COALESCE(?, year),
      total_seasons = COALESCE(?, total_seasons),
      total_episodes = COALESCE(?, total_episodes),
      is_on_air = COALESCE(?, is_on_air),
      airing_status = COALESCE(?, airing_status),
      next_air_date = COALESCE(?, next_air_date),
      last_air_date = COALESCE(?, last_air_date),
      poster_url = COALESCE(?, poster_url),
      updated_at = datetime('now')
    WHERE id = ?
  `, [
    tmdbId,
    extra?.year ?? null,
    seasons ?? null,
    episodes ?? null,
    extra?.isOnAir != null ? (extra.isOnAir ? 1 : 0) : null,
    extra?.airingStatus ?? null,
    extra?.nextAirDate ?? null,
    extra?.lastAirDate ?? null,
    extra?.posterUrl ?? null,
    id,
  ]);
}

export async function updateTitleAiringInfo(
  id: number,
  data: {
    year?: number;
    isOnAir?: boolean;
    airingStatus?: string;
    nextAirDate?: string;
    lastAirDate?: string;
    totalEpisodes?: number;
    lastScrapedAt?: string;
  }
): Promise<void> {
  await dbRun(`
    UPDATE titles SET
      year = COALESCE(?, year),
      is_on_air = COALESCE(?, is_on_air),
      airing_status = COALESCE(?, airing_status),
      next_air_date = ?,
      last_air_date = COALESCE(?, last_air_date),
      total_episodes = COALESCE(?, total_episodes),
      last_scraped_at = COALESCE(?, last_scraped_at),
      updated_at = datetime('now')
    WHERE id = ?
  `, [
    data.year ?? null,
    data.isOnAir != null ? (data.isOnAir ? 1 : 0) : null,
    data.airingStatus ?? null,
    data.nextAirDate ?? null,
    data.lastAirDate ?? null,
    data.totalEpisodes ?? null,
    data.lastScrapedAt ?? null,
    id,
  ]);
}

export async function updateTitleStatus(id: number, status: string): Promise<void> {
  await dbRun("UPDATE titles SET status = ?, updated_at = datetime('now') WHERE id = ?", [status, id]);
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export interface VideoRow {
  id: number;
  title_id: number;
  tmdb_id: number;
  season: number | null;
  episode: number | null;
  is_movie: number;
  dm_account_id: number | null;
  dm_video_id: string | null;
  dm_video_url: string | null;
  dm_title: string;
  source_url: string | null;
  resolution: string | null;
  file_size_mb: number | null;
  duration_seconds: number | null;
  upload_status: string;
  error_message: string | null;
  takedown_detected_at?: string | null;
  takedown_reason?: string | null;
  flagged_sources?: string | null;
  title_name?: string;
  title_status?: string;
  account_label?: string;
  poster_url?: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertVideo(data: {
  titleId: number;
  tmdbId: number;
  season?: number;
  episode?: number;
  isMovie: boolean;
  dmTitle: string;
  resolution?: string;
  fileSizeMb?: number;
}): Promise<VideoRow | undefined> {
  await dbRun(`
    INSERT INTO videos (title_id, tmdb_id, season, episode, is_movie, dm_title, resolution, file_size_mb)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmdb_id, season, episode) DO UPDATE SET
      resolution = COALESCE(excluded.resolution, videos.resolution),
      file_size_mb = COALESCE(excluded.file_size_mb, videos.file_size_mb),
      updated_at = datetime('now')
  `, [
    data.titleId,
    data.tmdbId,
    data.season ?? null,
    data.episode ?? null,
    data.isMovie ? 1 : 0,
    data.dmTitle,
    data.resolution ?? null,
    data.fileSizeMb ?? null,
  ]);

  return getVideoByLookup(data.tmdbId, data.season, data.episode);
}

export async function getVideoByLookup(tmdbId: number, season?: number, episode?: number): Promise<VideoRow | undefined> {
  if (season != null && episode != null) {
    return dbGet<VideoRow>('SELECT * FROM videos WHERE tmdb_id = ? AND season = ? AND episode = ?', [tmdbId, season, episode]);
  }
  return dbGet<VideoRow>('SELECT * FROM videos WHERE tmdb_id = ? AND is_movie = 1', [tmdbId]);
}

export async function getVideosByTmdbId(tmdbId: number): Promise<VideoRow[]> {
  return dbAll<VideoRow>('SELECT * FROM videos WHERE tmdb_id = ? ORDER BY season, episode', [tmdbId]);
}

export async function getAllVideos(options: { q?: string; status?: string; limit?: number } = {}): Promise<VideoRow[]> {
  let sql = `
    SELECT v.*, t.title as title_name, t.poster_url as poster_url, a.label as account_label
    FROM videos v
    LEFT JOIN titles t ON v.title_id = t.id
    LEFT JOIN dm_accounts a ON v.dm_account_id = a.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (options.q) {
    sql += ' AND (t.title LIKE ? OR v.dm_title LIKE ? OR v.dm_video_id LIKE ? OR v.tmdb_id LIKE ?)';
    params.push(`%${options.q}%`, `%${options.q}%`, `%${options.q}%`, `%${options.q}%`);
  }
  if (options.status) {
    sql += ' AND v.upload_status = ?';
    params.push(options.status);
  }

  const limit = options.limit || 200;
  sql += ' ORDER BY v.id DESC LIMIT ?';
  params.push(limit);

  return dbAll<VideoRow>(sql, params);
}

export async function getTakedownVideos(limit = 100): Promise<VideoRow[]> {
  return dbAll<VideoRow>(`
    SELECT v.*, t.title as title_name, t.poster_url as poster_url, t.status as title_status, a.label as account_label
    FROM videos v
    LEFT JOIN titles t ON v.title_id = t.id
    LEFT JOIN dm_accounts a ON v.dm_account_id = a.id
    WHERE v.upload_status = 'takedown'
    ORDER BY v.id DESC
    LIMIT ?
  `, [limit]);
}

export async function getUploadedVideos(limit = 500): Promise<VideoRow[]> {
  return dbAll<VideoRow>(`
    SELECT v.*, t.title as title_name, a.label as account_label
    FROM videos v
    LEFT JOIN titles t ON v.title_id = t.id
    LEFT JOIN dm_accounts a ON v.dm_account_id = a.id
    WHERE v.upload_status = 'uploaded' AND v.dm_video_id IS NOT NULL
    ORDER BY v.id DESC
    LIMIT ?
  `, [limit]);
}

export async function markVideoTakedown(id: number, reason = 'Flagged by Dailymotion Automated Fingerprint Recognition'): Promise<void> {
  const video = await dbGet<VideoRow>('SELECT * FROM videos WHERE id = ?', [id]);
  const now = new Date().toISOString();

  let flaggedSources: any[] = [];
  try {
    flaggedSources = JSON.parse(video?.flagged_sources || '[]');
  } catch {}

  if (video?.source_url && !flaggedSources.some(f => f.url === video.source_url)) {
    flaggedSources.push({
      url: video.source_url,
      sizeMb: video.file_size_mb,
      resolution: video.resolution,
      reason,
      flaggedAt: now,
    });
  }

  await dbRun(`
    UPDATE videos SET
      upload_status = 'takedown',
      error_message = ?,
      takedown_reason = ?,
      takedown_detected_at = ?,
      flagged_sources = ?,
      updated_at = ?
    WHERE id = ?
  `, [reason, reason, now, JSON.stringify(flaggedSources), now, id]);

  // If video belonged to a swarm account, increment strike count on that account
  if (video && video.dm_account_id) {
    await incrementAccountStrike(video.dm_account_id, reason);
  }

  // Automatically place parent title on safe hold to pause immediate re-uploads until alternative fallback decision
  if (video && video.title_id) {
    await dbRun("UPDATE titles SET status = 'blacklisted', updated_at = datetime('now') WHERE id = ?", [video.title_id]);
    console.warn(`🛑 Safe hold: Title #${video.title_id} temporarily blacklisted until fallback retry.`);
  }
}

export async function blacklistTitle(id: number): Promise<void> {
  await dbRun("UPDATE titles SET status = 'blacklisted', updated_at = datetime('now') WHERE id = ?", [id]);
}

export async function unblacklistTitle(id: number): Promise<void> {
  await dbRun("UPDATE titles SET status = 'discovered', updated_at = datetime('now') WHERE id = ?", [id]);
}

export async function requeueTakedownVideo(id: number): Promise<void> {
  const video = await dbGet<VideoRow>('SELECT * FROM videos WHERE id = ?', [id]);
  const now = new Date().toISOString();

  let flaggedSources: any[] = [];
  try {
    flaggedSources = JSON.parse(video?.flagged_sources || '[]');
  } catch {}

  if (video?.source_url && !flaggedSources.some(f => f.url === video.source_url)) {
    flaggedSources.push({
      url: video.source_url,
      sizeMb: video.file_size_mb,
      resolution: video.resolution,
      reason: video.takedown_reason || 'Fingerprint Recognition Suspension',
      flaggedAt: now,
    });
  }

  await dbRun(`
    UPDATE videos SET
      upload_status = 'pending',
      dm_account_id = NULL,
      dm_video_id = NULL,
      dm_video_url = NULL,
      source_url = NULL,
      flagged_sources = ?,
      error_message = 'Requeued for alternative release fallback upload',
      updated_at = datetime('now')
    WHERE id = ?
  `, [JSON.stringify(flaggedSources), id]);

  // Automatically unblock parent title to 'processing' so pipeline immediately ingests alternative encode
  if (video && video.title_id) {
    await dbRun("UPDATE titles SET status = 'processing', updated_at = datetime('now') WHERE id = ?", [video.title_id]);
    console.log(`✅ Title #${video.title_id} restored to 'processing' for alternative release retry.`);
  }
}

export async function requeueAllTakedowns(): Promise<number> {
  const takedowns = await dbAll<VideoRow>("SELECT * FROM videos WHERE upload_status = 'takedown'");
  for (const v of takedowns) {
    await requeueTakedownVideo(v.id);
  }
  return takedowns.length;
}

export async function dismissTakedownVideo(id: number): Promise<void> {
  await dbRun(`
    UPDATE videos SET
      upload_status = 'archived',
      updated_at = datetime('now')
    WHERE id = ?
  `, [id]);
}

export async function getPendingVideos(limit = 10): Promise<VideoRow[]> {
  return dbAll<VideoRow>("SELECT * FROM videos WHERE upload_status = 'pending' LIMIT ?", [limit]);
}

export async function updateVideoUpload(id: number, data: {
  dmAccountId: number;
  dmVideoId: string;
  dmVideoUrl: string;
  sourceUrl: string;
  durationSeconds?: number;
}): Promise<void> {
  await dbRun(`
    UPDATE videos SET
      dm_account_id = ?,
      dm_video_id = ?,
      dm_video_url = ?,
      source_url = ?,
      duration_seconds = COALESCE(?, duration_seconds, 0),
      upload_status = 'uploaded',
      error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `, [data.dmAccountId, data.dmVideoId, data.dmVideoUrl, data.sourceUrl, data.durationSeconds ?? null, id]);
}

export async function updateVideoHold(id: number, reason: string): Promise<void> {
  await dbRun(`
    UPDATE videos SET
      upload_status = 'on_hold',
      error_message = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `, [reason, id]);
}

export async function resetHoldVideos(): Promise<number> {
  const result = await dbRun(`
    UPDATE videos SET
      upload_status = 'pending',
      error_message = NULL,
      updated_at = datetime('now')
    WHERE upload_status = 'on_hold'
  `);
  return result.changes || 0;
}

export async function getHoldVideos(limit = 50): Promise<VideoRow[]> {
  return dbAll<VideoRow>("SELECT * FROM videos WHERE upload_status = 'on_hold' ORDER BY id ASC LIMIT ?", [limit]);
}

export async function updateVideoError(id: number, error: string): Promise<void> {
  await dbRun(`
    UPDATE videos SET
      upload_status = 'failed',
      error_message = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `, [error, id]);
}

// ---------------------------------------------------------------------------
// DM Accounts & Strike Management
// ---------------------------------------------------------------------------

export interface DmAccountRow {
  id: number;
  label: string;
  api_key: string;
  api_secret: string;
  access_token: string | null;
  token_expires: string | null;
  upload_count: number;
  daily_upload_count: number;
  daily_duration_seconds: number;
  daily_reset_at: string | null;
  strike_count: number;
  status: string; // 'active' | 'warning' | 'quarantined'
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

export async function addDmAccount(data: {
  label: string;
  apiKey: string;
  apiSecret: string;
}): Promise<DmAccountRow | undefined> {
  await dbRun(`
    INSERT INTO dm_accounts (label, api_key, api_secret, strike_count, status, is_active)
    VALUES (?, ?, ?, 0, 'active', 1)
  `, [data.label, data.apiKey, data.apiSecret]);

  // When a new account is added to the swarm, immediately release any on-hold videos back to pending
  await resetHoldVideos();

  return dbGet<DmAccountRow>('SELECT * FROM dm_accounts WHERE label = ? ORDER BY id DESC LIMIT 1', [data.label]);
}

export const DAILY_UPLOAD_LIMIT = 10;
export const DAILY_DURATION_LIMIT_SECONDS = 7200; // 2.0 hours (Dailymotion free creator daily limit)
export const MAX_ALLOWED_STRIKES = 2; // Auto-quarantine at 2 strikes to prevent account termination

async function performDailyResetIfNeeded(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const resetRes = await dbRun(`
    UPDATE dm_accounts
    SET daily_upload_count = 0, daily_duration_seconds = 0, daily_reset_at = ?
    WHERE daily_reset_at IS NULL OR daily_reset_at < ?
  `, [today, today]);

  // If any account underwent daily reset, release all on_hold videos for upload
  if (resetRes.changes > 0) {
    await resetHoldVideos();
  }
}

export async function getActiveDmAccounts(): Promise<DmAccountRow[]> {
  await performDailyResetIfNeeded();

  return dbAll<DmAccountRow>(`
    SELECT * FROM dm_accounts
    WHERE is_active = 1 
      AND COALESCE(status, 'active') != 'quarantined'
      AND COALESCE(strike_count, 0) < ?
      AND daily_upload_count < ?
      AND COALESCE(daily_duration_seconds, 0) < ?
    ORDER BY daily_upload_count ASC, COALESCE(daily_duration_seconds, 0) ASC, upload_count ASC
  `, [MAX_ALLOWED_STRIKES, DAILY_UPLOAD_LIMIT, DAILY_DURATION_LIMIT_SECONDS]);
}

export async function getAllDmAccounts(): Promise<DmAccountRow[]> {
  await performDailyResetIfNeeded();
  return dbAll<DmAccountRow>('SELECT * FROM dm_accounts ORDER BY id ASC');
}

export async function incrementAccountStrike(id: number, reason?: string): Promise<void> {
  const account = await dbGet<DmAccountRow>('SELECT * FROM dm_accounts WHERE id = ?', [id]);
  if (!account) return;

  const newStrikeCount = (account.strike_count || 0) + 1;
  let newStatus = 'active';

  if (newStrikeCount >= MAX_ALLOWED_STRIKES) {
    newStatus = 'quarantined';
    console.warn(`🚨 Account #${id} ("${account.label}") reached ${newStrikeCount} strikes! AUTO-QUARANTINING node to protect account.`);
    await dbRun(`
      UPDATE dm_accounts SET
        strike_count = ?,
        status = 'quarantined',
        is_active = 0,
        last_used_at = datetime('now')
      WHERE id = ?
    `, [newStrikeCount, id]);
  } else {
    newStatus = 'warning';
    console.warn(`⚠️ Account #${id} ("${account.label}") received strike ${newStrikeCount}/${MAX_ALLOWED_STRIKES}.`);
    await dbRun(`
      UPDATE dm_accounts SET
        strike_count = ?,
        status = 'warning',
        last_used_at = datetime('now')
      WHERE id = ?
    `, [newStrikeCount, id]);
  }
}

export async function resetAccountStrikes(id: number): Promise<void> {
  await dbRun(`
    UPDATE dm_accounts SET
      strike_count = 0,
      status = 'active',
      is_active = 1,
      last_used_at = datetime('now')
    WHERE id = ?
  `, [id]);
  console.log(`✅ Strikes reset and node #${id} reactivated.`);
}

export async function quarantineDmAccount(id: number): Promise<void> {
  await dbRun(`
    UPDATE dm_accounts SET status = 'quarantined', is_active = 0 WHERE id = ?
  `, [id]);
}

export async function reactivateDmAccount(id: number): Promise<void> {
  await dbRun(`
    UPDATE dm_accounts SET status = 'active', is_active = 1 WHERE id = ?
  `, [id]);
}

export async function updateDmAccountToken(id: number, token: string, expiresAt: string): Promise<void> {
  await dbRun(`
    UPDATE dm_accounts SET access_token = ?, token_expires = ? WHERE id = ?
  `, [token, expiresAt, id]);
}

export async function incrementDmAccountUpload(id: number, durationSeconds = 3600): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await performDailyResetIfNeeded();

  await dbRun(`
    UPDATE dm_accounts SET
      upload_count = upload_count + 1,
      daily_upload_count = daily_upload_count + 1,
      daily_duration_seconds = COALESCE(daily_duration_seconds, 0) + ?,
      daily_reset_at = ?,
      last_used_at = datetime('now')
    WHERE id = ?
  `, [durationSeconds, today, id]);
}

export async function deactivateDmAccount(id: number): Promise<void> {
  await dbRun('UPDATE dm_accounts SET is_active = 0 WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getStats(): Promise<{
  totalTitles: number;
  totalVideos: number;
  uploadedVideos: number;
  pendingVideos: number;
  takedownVideos: number;
  failedVideos: number;
  activeAccounts: number;
  quarantinedAccounts: number;
}> {
  const totalTitles = ((await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM titles'))?.c) || 0;
  const totalVideos = ((await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM videos'))?.c) || 0;
  const uploadedVideos = ((await dbGet<{ c: number }>("SELECT COUNT(*) as c FROM videos WHERE upload_status = 'uploaded'"))?.c) || 0;
  const pendingVideos = ((await dbGet<{ c: number }>("SELECT COUNT(*) as c FROM videos WHERE upload_status = 'pending'"))?.c) || 0;
  const takedownVideos = ((await dbGet<{ c: number }>("SELECT COUNT(*) as c FROM videos WHERE upload_status = 'takedown'"))?.c) || 0;
  const failedVideos = ((await dbGet<{ c: number }>("SELECT COUNT(*) as c FROM videos WHERE upload_status = 'failed'"))?.c) || 0;
  const activeAccounts = ((await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM dm_accounts WHERE is_active = 1'))?.c) || 0;
  const quarantinedAccounts = ((await dbGet<{ c: number }>("SELECT COUNT(*) as c FROM dm_accounts WHERE is_active = 0"))?.c) || 0;

  return { totalTitles, totalVideos, uploadedVideos, pendingVideos, takedownVideos, failedVideos, activeAccounts, quarantinedAccounts };
}
