/**
 * Dailymotion Video Health & Takedown Detection Scanner
 * 
 * Periodically monitors all uploaded videos on Dailymotion to detect:
 * - 404 Deletions (Audible Magic / INA digital fingerprint suspensions)
 * - Platform moderation suspensions
 * - Increments strike counters on the hosting swarm node
 * - Auto-quarantines worker nodes that reach threshold strikes to protect account health
 */

import { getUploadedVideos, markVideoTakedown, getAllDmAccounts, type VideoRow } from '../db/queries';

export interface VideoHealthResult {
  videoId: string;
  alive: boolean;
  status?: string;
  reason?: string;
  statusCode?: number;
  skipped?: boolean;
}

export interface SwarmHealthScanSummary {
  totalChecked: number;
  aliveCount: number;
  takedownCount: number;
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
}

/**
 * Check health of a single Dailymotion video ID using public API endpoint
 */
export async function checkDmVideoHealth(videoId: string): Promise<VideoHealthResult> {
  const cleanId = videoId.replace(/^k/, ''); // Handle both private hash or direct ID
  const url = `https://api.dailymotion.com/video/${cleanId}?fields=id,title,status,private`;

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
        statusCode: 404,
        reason: data?.error?.message || 'Video suspended or deleted by Dailymotion fingerprint scanner',
      };
    }

    // 2. Status indicates deletion / suspension
    if (data && (data.status === 'deleted' || data.status === 'suspended' || data.status === 'rejected')) {
      return {
        videoId,
        alive: false,
        statusCode: res.status,
        reason: `Video status is '${data.status}'`,
      };
    }

    // 3. Alive & reachable
    if (res.ok && data?.id) {
      return {
        videoId,
        alive: true,
        status: data.status || 'ready',
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
 */
export async function scanAllSwarmVideosHealth(options: { maxCheck?: number } = {}): Promise<SwarmHealthScanSummary> {
  const maxCheck = options.maxCheck || 200;
  const videos = await getUploadedVideos(maxCheck);

  let aliveCount = 0;
  let takedownCount = 0;
  const takedowns: SwarmHealthScanSummary['takedowns'] = [];

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
      } else {
        takedownCount++;
        const reason = health.reason || 'Flagged by Dailymotion Automated Fingerprint Recognition';
        console.warn(`  🚨 TAKEDOWN DETECTED: [${v.dm_video_id}] "${v.title_name || v.dm_title}" (Account #${v.dm_account_id}) -> ${reason}`);
        
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

  console.log(`🩺 Health Scan Complete: ${aliveCount} Healthy, ${takedownCount} Takedowns Detected, ${quarantinedAccounts} Quarantined Nodes.\n`);

  return {
    totalChecked: videos.length,
    aliveCount,
    takedownCount,
    quarantinedAccounts,
    takedowns,
  };
}
