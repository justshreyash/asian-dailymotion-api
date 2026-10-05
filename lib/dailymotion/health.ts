/**
 * Dailymotion Video Health & Takedown Detection Scanner
 * 
 * Periodically monitors all uploaded videos on Dailymotion to detect:
 * - 404 Deletions (Audible Magic / INA digital fingerprint suspensions)
 * - Platform moderation suspensions
 * - Increments strike counters on the hosting swarm node
 * - Auto-quarantines worker nodes that reach threshold strikes to protect account health
 */

import { getUploadedVideos, markVideoTakedown, markVideoEncodingError, getAllDmAccounts, type VideoRow } from '../db/queries';
import { DmSwarm } from './swarm';

export interface VideoHealthResult {
  videoId: string;
  alive: boolean;
  status?: string;
  reason?: string;
  statusCode?: number;
  isEncodingError?: boolean;
  isTakedown?: boolean;
  skipped?: boolean;
}

export interface SwarmHealthScanSummary {
  totalChecked: number;
  aliveCount: number;
  takedownCount: number;
  encodingErrorCount: number;
  quarantinedAccounts: number;
  takedowns: Array<{
    id: number;
    titleName?: string;
    tmdbId: number;
    season: number | null;
    episode: number | null;
    dmVideoId: string;
    accountLabel?: string;
    reason: string;
  }>;
  healedErrors: Array<{
    id: number;
    titleName?: string;
    tmdbId: number;
    season: number | null;
    episode: number | null;
    dmVideoId: string;
    reason: string;
  }>;
}

/**
 * Check health of a single Dailymotion video ID using public API endpoint
 */
export async function checkDmVideoHealth(videoId: string): Promise<VideoHealthResult> {
  const url = `https://api.dailymotion.com/video/${videoId}?fields=id,title,status,encoding_progress,publishing_progress,available_formats,published,private`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => null);

    // 1. Explicit 404 or not_found error from Dailymotion
    if (res.status === 404 || (data?.error && (data.error.code === 404 || data.error.type === 'not_found'))) {
      return {
        videoId,
        alive: false,
        isTakedown: true,
        statusCode: 404,
        reason: data?.error?.message || 'Video suspended or deleted by Dailymotion fingerprint scanner',
      };
    }

    // 2. Encoding failure (e.g. unsupported codec like AV1 or corrupted stream)
    if (
      data?.status === 'encoding_error' ||
      data?.encoding_progress === -1 ||
      (data?.published === false && Array.isArray(data?.available_formats) && data.available_formats.length === 0 && data?.status !== 'processing')
    ) {
      return {
        videoId,
        alive: false,
        isEncodingError: true,
        statusCode: res.status,
        reason: 'Dailymotion encoding error (unsupported codec or corrupted stream container)',
      };
    }

    // 3. Status indicates deletion / moderation suspension
    if (data && (data.status === 'deleted' || data.status === 'suspended' || data.status === 'rejected')) {
      return {
        videoId,
        alive: false,
        isTakedown: true,
        statusCode: res.status,
        reason: `Video status is '${data.status}'`,
      };
    }

    // 4. Processing / encoding in progress
    if (data?.status === 'processing' || (data?.encoding_progress != null && data.encoding_progress >= 0 && data.encoding_progress < 100)) {
      return {
        videoId,
        alive: true,
        status: 'processing',
        statusCode: res.status,
      };
    }

    // 5. Alive & published / ready
    if (res.ok && data?.id && (data.status === 'ready' || data.status === 'published' || data.published === true || (Array.isArray(data.available_formats) && data.available_formats.length > 0))) {
      return {
        videoId,
        alive: true,
        status: data.status || 'published',
        statusCode: res.status,
      };
    }

    // If unexpected rate-limit or 5xx server issue, do not falsely flag as takedown
    if (res.status === 429 || res.status >= 500) {
      return { videoId, alive: true, skipped: true, reason: `HTTP ${res.status} upstream issue` };
    }

    return {
      videoId,
      alive: false,
      isTakedown: true,
      statusCode: res.status,
      reason: data?.error?.message || `HTTP ${res.status} response from Dailymotion`,
    };
  } catch (err) {
    // Network / abort error - do not mark as takedown
    return {
      videoId,
      alive: true,
      skipped: true,
      reason: `Scan network error: ${(err as Error).message}`,
    };
  }
}

/**
 * Run a full or batch health scan across all uploaded videos in the swarm.
 * Automatically purges corrupted/encoding-error videos on Dailymotion and resets them in DB for alternative clean uploads.
 */
export async function scanAllSwarmVideosHealth(options: { maxCheck?: number } = {}): Promise<SwarmHealthScanSummary> {
  const maxCheck = options.maxCheck || 200;
  const videos = await getUploadedVideos(maxCheck);
  const swarm = new DmSwarm();

  let aliveCount = 0;
  let takedownCount = 0;
  let encodingErrorCount = 0;
  const takedowns: SwarmHealthScanSummary['takedowns'] = [];
  const healedErrors: SwarmHealthScanSummary['healedErrors'] = [];

  console.log(`\n🩺 Starting Dailymotion Swarm Video Health Check for ${videos.length} videos...`);

  // Process in chunks of 5 with 200ms spacing to avoid DM rate limits
  const CHUNK_SIZE = 5;
  for (let i = 0; i < videos.length; i += CHUNK_SIZE) {
    const chunk = videos.slice(i, i + CHUNK_SIZE);
    
    await Promise.all(chunk.map(async (v) => {
      if (!v.dm_video_id) return;

      const health = await checkDmVideoHealth(v.dm_video_id);

      if (health.alive) {
        aliveCount++;
      } else if (health.isEncodingError) {
        encodingErrorCount++;
        const reason = health.reason || 'Dailymotion encoding error';
        console.warn(`  ⚠️ ENCODING ERROR DETECTED: [${v.dm_video_id}] "${v.title_name || v.dm_title}" (Account #${v.dm_account_id}) -> Auto-purging from DM and resetting to pending for clean re-upload.`);
        
        // 1. Delete corrupted video from DM
        await swarm.deleteVideo(v.dm_video_id, v.dm_account_id);

        // 2. Reset in DB & flag source URL so alternative release will be chosen
        await markVideoEncodingError(v.id, reason);

        healedErrors.push({
          id: v.id,
          titleName: v.title_name,
          tmdbId: v.tmdb_id,
          season: v.season,
          episode: v.episode,
          dmVideoId: v.dm_video_id,
          reason,
        });
      } else {
        takedownCount++;
        const reason = health.reason || 'Flagged by Dailymotion Automated Fingerprint Recognition';
        console.warn(`  🚨 TAKEDOWN DETECTED: [${v.dm_video_id}] "${v.title_name || v.dm_title}" (Account #${v.dm_account_id}) -> ${reason}`);
        
        // 1. Delete from DM if still accessible
        await swarm.deleteVideo(v.dm_video_id, v.dm_account_id);

        // 2. Mark takedown in DB
        await markVideoTakedown(v.id, reason);

        takedowns.push({
          id: v.id,
          titleName: v.title_name,
          tmdbId: v.tmdb_id,
          season: v.season,
          episode: v.episode,
          dmVideoId: v.dm_video_id,
          accountLabel: v.account_label,
          reason,
        });
      }
    }));

    if (i + CHUNK_SIZE < videos.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const allAccounts = await getAllDmAccounts();
  const quarantinedAccounts = allAccounts.filter(a => a.status === 'quarantined' || a.strike_count >= 2).length;

  console.log(`🩺 Health Scan Complete: ${aliveCount} Healthy, ${encodingErrorCount} Encoding Errors Auto-Healed, ${takedownCount} Takedowns Handled, ${quarantinedAccounts} Quarantined Nodes.\n`);

  return {
    totalChecked: videos.length,
    aliveCount,
    takedownCount,
    encodingErrorCount,
    quarantinedAccounts,
    takedowns,
    healedErrors,
  };
}

