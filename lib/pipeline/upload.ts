/**
 * Pipeline Phase 3/4: Uploads
 * Checks titles for new episodes, selects best release, resolves direct URL,
 * and uploads via Dailymotion account swarm with Greedy Bin-Packing & Hold Queue.
 */

import { FourKHdHubClient } from '../scraper/client';
import { parseReleases, parseAllReleases } from '../scraper/parser';
import { selectBestReleases } from '../utils/release-picker';
import { formatDmTitle } from '../utils/title-format';
import { DmSwarm } from '../dailymotion/swarm';
import {
  getAllTitles,
  getVideosByTmdbId,
  getHoldVideos,
  getActiveDmAccounts,
  DAILY_UPLOAD_LIMIT,
  upsertVideo,
  updateVideoUpload,
  updateVideoHold,
  updateVideoError,
  updateTitleStatus,
  updateTitleAiringInfo,
} from '../db/queries';

export interface UploadRunOptions {
  maxUploads?: number;
  maxExecutionSeconds?: number;
  prioritizeTmdbId?: number;
}

export async function runUploads(options: UploadRunOptions = {}) {
  const activeAccounts = await getActiveDmAccounts();
  const totalSwarmSlots = activeAccounts.reduce(
    (sum, a) => sum + Math.max(0, DAILY_UPLOAD_LIMIT - (a.daily_upload_count || 0)),
    0
  );
  const maxUploads = options.maxUploads ?? Math.max(1, totalSwarmSlots);
  const maxExecutionSeconds = options.maxExecutionSeconds ?? 240; // Guard for Vercel 300s timeout
  const startTime = Date.now();

  const client = new FourKHdHubClient();
  const swarm = new DmSwarm();

  console.log(`\n🚀 Starting Intelligent Upload Pipeline (Dynamic limit: ${maxUploads} uploads across ${activeAccounts.length} active nodes)...`);

  let uploadsAttempted = 0;
  let itemsPutOnHold = 0;

  // 1. Fetch candidate titles (only mapped TMDB titles >= 2024, exclude failed, blacklisted, and skipped)
  const MIN_RELEASE_YEAR = 2024;
  const allTitles = await getAllTitles();
  let titles = allTitles.filter(t => 
    t.tmdb_id != null && 
    t.status !== 'failed' && 
    t.status !== 'blacklisted' &&
    t.status !== 'skipped' &&
    (t.year == null || t.year >= MIN_RELEASE_YEAR)
  );

  // 2. Prioritize: 
  // Priority 1: explicitly requested title (e.g. prioritizeTmdbId)
  // Priority 2: DRAMAS / TV SERIES FIRST (kind === 'series' ALWAYS before kind === 'movie')
  // Priority 3: on-air series (active releases currently broadcasting)
  // Priority 4: release year descending (2026 -> 2025 -> 2024)
  // Priority 5: in-progress processing titles (status = 'processing')
  // Priority 6: newest discovered date (created_at DESC)
  titles.sort((a, b) => {
    if (options.prioritizeTmdbId) {
      if (a.tmdb_id === options.prioritizeTmdbId) return -1;
      if (b.tmdb_id === options.prioritizeTmdbId) return 1;
    }

    // 1. TOP PRIORITY: Dramas / TV Series ALWAYS come before Movies!
    const aIsSeries = a.kind === 'series' ? 1 : 0;
    const bIsSeries = b.kind === 'series' ? 1 : 0;
    if (aIsSeries !== bIsSeries) return bIsSeries - aIsSeries; // 1 (series) comes before 0 (movie)

    // 2. On-Air / Returning series first
    const aOnAir = (a.is_on_air === 1 || a.airing_status === 'Returning Series' || a.airing_status === 'In Production') ? 1 : 0;
    const bOnAir = (b.is_on_air === 1 || b.airing_status === 'Returning Series' || b.airing_status === 'In Production') ? 1 : 0;
    if (aOnAir !== bOnAir) return bOnAir - aOnAir;

    // 3. Release Year descending (2026 -> 2025 -> 2024)
    const aYear = a.year || 0;
    const bYear = b.year || 0;
    if (aYear !== bYear) return bYear - aYear;

    // 4. In-progress processing titles
    const aProcessing = a.status === 'processing' ? 1 : 0;
    const bProcessing = b.status === 'processing' ? 1 : 0;
    if (aProcessing !== bProcessing) return bProcessing - aProcessing;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  for (const title of titles) {
    if (title.tmdb_id == null) continue;

    // Timeout guard check (ensure Vercel function terminates safely before timeout)
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds >= maxExecutionSeconds) {
      console.log(`\n⏱️ Execution time limit reached (${elapsedSeconds.toFixed(1)}s / ${maxExecutionSeconds}s). Wrapping up.`);
      break;
    }

    if (uploadsAttempted >= maxUploads) {
      console.log(`\n🎯 Max upload limit per batch reached (${uploadsAttempted}/${maxUploads}). Stopping run.`);
      break;
    }

    // Check swarm max available capacity vs temporary burst cooldowns
    let maxCapacitySeconds = await swarm.getMaxRemainingDuration();
    if (maxCapacitySeconds < 300) {
      const dailyRemaining = await swarm.getDailyRemainingDuration();
      if (dailyRemaining < 300) {
        console.log(`\n🛑 All Dailymotion accounts exhausted true daily limits (14 vids or 9.5 hrs limit) for today. Stopping uploads.`);
        break;
      }

      // Swarm is in temporary burst rate limit cooldown
      const waitSec = await swarm.getMinCooldownRemainingSeconds();
      const currentElapsed = (Date.now() - startTime) / 1000;
      if (waitSec > 0 && currentElapsed + waitSec < maxExecutionSeconds) {
        console.log(`\n⏳ Swarm nodes in temporary burst cooldown. Waiting ${Math.round(waitSec / 60)}m (${waitSec}s) for rate limit window to reset before automatically resuming uploads...`);
        await sleep(waitSec * 1000);
        maxCapacitySeconds = await swarm.getMaxRemainingDuration();
      } else {
        console.log(`\n⏳ Swarm nodes in temporary burst cooldown. Next hourly run will resume automatically.`);
        break;
      }
    }

    console.log(`\n📺 Processing: ${title.title} (${title.kind.toUpperCase()}${title.is_on_air ? ' - ON AIR' : ''}) [Swarm Max Free: ${Math.round(maxCapacitySeconds / 60)}m]`);
    
    try {
      // Fetch HTML once for all episodes of this title
      const html = await client.fetchRawHtml(title.slug);
      await updateTitleAiringInfo(title.id, { lastScrapedAt: new Date().toISOString() });

      const isMovie = title.kind === 'movie';
      const existingVideos = await getVideosByTmdbId(title.tmdb_id);

      if (isMovie) {
        // MOVIE LOGIC
        const existing = existingVideos[0];
        if (existing?.upload_status === 'uploaded') {
          await updateTitleStatus(title.id, 'completed');
          console.log(`  ✅ Movie already uploaded.`);
          continue;
        }
        if (existing?.upload_status === 'takedown') {
          continue; // wait for explicit requeue / fallback
        }

        let excludeSizesMb: number[] = [];
        let excludeUrls: string[] = [];
        if (existing?.flagged_sources) {
          try {
            const list = JSON.parse(existing.flagged_sources);
            for (const item of list) {
              if (item.sizeMb) excludeSizesMb.push(item.sizeMb);
              if (item.url) excludeUrls.push(item.url);
            }
          } catch {}
        }

        const releases = parseAllReleases(html);
        if (releases.length === 0) {
          console.log(`  ℹ️ No releases found on page for movie.`);
          continue;
        }

        const bestReleases = selectBestReleases(releases, {
          excludeSizesMb,
          excludeUrls,
          preferAlternativeCodec: excludeSizesMb.length > 0,
          preferAlternativeSource: excludeSizesMb.length > 0,
        });
        if (bestReleases.length === 0) {
          console.log(`  ℹ️ All available releases for this movie match previously flagged sources.`);
          continue;
        }

        const result = await attemptUpload(client, swarm, title.id, title.tmdb_id, true, null, null, bestReleases);
        if (result === 'uploaded') {
          uploadsAttempted++;
          await updateTitleStatus(title.id, 'completed');
        } else if (result === 'on_hold') {
          itemsPutOnHold++;
        }

      } else {
        // SERIES LOGIC
        let uploadedEpsCount = existingVideos.filter(v => v.upload_status === 'uploaded').length;
        let expectedTotal = title.total_episodes || 0;
        let consecutiveEmpty = 0;

        for (let s = 1; s <= (title.total_seasons || 1); s++) {
          const maxEps = title.total_episodes ? title.total_episodes + 2 : 40;
          
          for (let e = 1; e <= maxEps; e++) {
            // Check limits
            if (uploadsAttempted >= maxUploads) break;
            if ((Date.now() - startTime) / 1000 >= maxExecutionSeconds) break;

            const existing = existingVideos.find(v => v.season === s && v.episode === e);
            if (existing?.upload_status === 'uploaded') {
              consecutiveEmpty = 0;
              continue;
            }
            if (existing?.upload_status === 'takedown') {
              // Waiting for explicit requeue / fallback
              continue;
            }

            let excludeSizesMb: number[] = [];
            let excludeUrls: string[] = [];
            if (existing?.flagged_sources) {
              try {
                const list = JSON.parse(existing.flagged_sources);
                for (const item of list) {
                  if (item.sizeMb) excludeSizesMb.push(item.sizeMb);
                  if (item.url) excludeUrls.push(item.url);
                }
              } catch {}
            }

            const releases = parseReleases(html, s, e);
            if (releases.length === 0) {
              consecutiveEmpty++;
              // If we encounter 3 empty episodes past season bounds, break
              if (consecutiveEmpty >= 3 && e > (expectedTotal || 3)) break;
              continue;
            }

            consecutiveEmpty = 0;
            const bestReleases = selectBestReleases(releases, {
              excludeSizesMb,
              excludeUrls,
              preferAlternativeCodec: excludeSizesMb.length > 0,
              preferAlternativeSource: excludeSizesMb.length > 0,
            });

            if (bestReleases.length === 0) {
              console.log(`    ⚠️ S${s}E${e}: All releases match previously flagged sources. Skipping.`);
              continue;
            }

            // Check swarm max available capacity vs temporary burst cooldowns before processing episode
            let maxCapacitySeconds = await swarm.getMaxRemainingDuration();
            if (maxCapacitySeconds < 300) {
              const dailyRemaining = await swarm.getDailyRemainingDuration();
              if (dailyRemaining < 300) {
                console.log(`\n🛑 All Dailymotion accounts exhausted true daily limits for today. Stopping uploads.`);
                break;
              }

              const waitSec = await swarm.getMinCooldownRemainingSeconds();
              const currentElapsed = (Date.now() - startTime) / 1000;
              if (waitSec > 0 && currentElapsed + waitSec < maxExecutionSeconds) {
                console.log(`\n⏳ Swarm hit burst rate limit. Auto-waiting ${Math.round(waitSec / 60)}m (${waitSec}s) for Dailymotion window to reset...`);
                await sleep(waitSec * 1000);
                maxCapacitySeconds = await swarm.getMaxRemainingDuration();
              } else {
                console.log(`\n⏳ Swarm nodes in temporary burst cooldown. Next batch will resume automatically.`);
                break;
              }
            }

            console.log(`  📦 Checking S${s}E${e} (${bestReleases.length} releases available${excludeSizesMb.length > 0 ? ', fallback diversity active' : ''})`);
            const result = await attemptUpload(client, swarm, title.id, title.tmdb_id, false, s, e, bestReleases);
            
            if (result === 'uploaded') {
              uploadedEpsCount++;
              uploadsAttempted++;
              // Safe spacing between uploads to prevent Dailymotion burst rate limit errors
              await sleep(20000);
            } else if (result === 'on_hold') {
              itemsPutOnHold++;
              // If on hold due to burst cooldown, let next iteration evaluate cooldown wait
              const rem = await swarm.getMaxRemainingDuration();
              if (rem < 300) {
                // Decrement episode index so it retries this exact episode after cooldown
                e--;
                continue;
              }
            }
          }
          if (uploadsAttempted >= maxUploads) break;
        }

        if (expectedTotal > 0 && uploadedEpsCount >= expectedTotal && !title.is_on_air) {
          await updateTitleStatus(title.id, 'completed');
        } else {
          await updateTitleStatus(title.id, 'processing');
        }
      }

    } catch (err) {
      console.log(`  ❌ Failed processing title ${title.slug}: ${(err as Error).message}`);
    }
  }

  console.log(`\n✅ Upload pipeline finished. Uploaded ${uploadsAttempted} items, ${itemsPutOnHold} on hold for capacity in ${((Date.now() - startTime) / 1000).toFixed(1)}s.`);
  return uploadsAttempted;
}

async function attemptUpload(
  client: FourKHdHubClient,
  swarm: DmSwarm,
  titleId: number,
  tmdbId: number,
  isMovie: boolean,
  season: number | null,
  episode: number | null,
  bestReleases: any[]
): Promise<'uploaded' | 'on_hold' | 'failed'> {
  const dmTitle = formatDmTitle(tmdbId, isMovie, season || undefined, episode || undefined);
  const estimatedDurationSeconds = isMovie ? 5400 : 3600;

  // Mark as pending in DB first with resolution & size
  const dbVideo = await upsertVideo({
    titleId,
    tmdbId,
    season: season || undefined,
    episode: episode || undefined,
    isMovie,
    dmTitle,
    resolution: bestReleases[0]?.resolution,
    fileSizeMb: bestReleases[0]?.sizeMb,
  });

  if (!dbVideo) {
    console.error('Failed to create/fetch dbVideo record');
    return 'failed';
  }

  // Check if any active account has capacity for this duration
  const qualifiedAccounts = await swarm.getQualifiedAccounts(estimatedDurationSeconds, bestReleases[0]?.sizeMb);
  if (qualifiedAccounts.length === 0) {
    const dailyRemaining = await swarm.getDailyRemainingDuration();
    if (dailyRemaining >= estimatedDurationSeconds) {
      // Temporary cooldown, not daily limit exceeded
      return 'on_hold';
    }
    const maxRemaining = await swarm.getMaxRemainingDuration();
    const reason = `Exceeds current node daily capacity (~${Math.round(estimatedDurationSeconds / 60)}m required, max available is ${Math.round(maxRemaining / 60)}m). Deferred on hold.`;
    console.log(`    ⏸️ [ON HOLD] ${reason}`);
    await updateVideoHold(dbVideo.id, reason);
    return 'on_hold';
  }

  for (const release of bestReleases) {
    try {
      // Guard against Dailymotion 4GB file size limit for free tier
      if (release.sizeMb && release.sizeMb > 3800) {
        console.log(`    ⚠️ Skipping release ${release.releaseTitle} (${release.sizeMb}MB exceeds 3.8GB DM limit)`);
        continue;
      }

      console.log(`    Trying release: ${release.releaseTitle} (${release.sizeMb}MB, ${release.resolution})`);
      
      const streamInfo = await client.resolveRelease(release);
      const result = await swarm.upload(streamInfo.url, dmTitle, {
        estimatedDurationSeconds,
        sizeMb: release.sizeMb,
      });

      if (result.success) {
        await updateVideoUpload(dbVideo.id, {
          dmAccountId: result.accountId!,
          dmVideoId: result.videoId!,
          dmVideoUrl: result.videoUrl!,
          sourceUrl: streamInfo.url,
          durationSeconds: result.duration,
        });
        console.log(`      ✅ Upload success: ${result.videoId} on account #${result.accountId}`);
        return 'uploaded';
      } else {
        console.log(`      Upload failed: ${result.error}`);
        if (
          result.error?.includes('Capacity hold') || 
          result.error?.includes('requires ~') ||
          result.error?.includes('rate limit') ||
          result.error?.includes('All DM accounts failed')
        ) {
          await updateVideoHold(dbVideo.id, result.error);
          return 'on_hold';
        }
      }
    } catch (e) {
      console.log(`      Failed to resolve/upload: ${(e as Error).message}`);
    }
  }

  // If all fallbacks failed or were throttled, defer on hold for next cycle
  await updateVideoHold(dbVideo.id, 'Deferred on hold for next available swarm slot or alternative release');
  return 'on_hold';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

